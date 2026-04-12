param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$Repo = "ShuaiLeiLu/DY_luckybag",
  [string]$Target = "main",
  [string]$HotBaseUrl = "",
  [string]$GitHubToken = "",
  [switch]$SkipGitHub
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info([string]$message) {
  Write-Host "[release] $message"
}

function Normalize-Version([string]$rawVersion) {
  $value = ""
  if ($null -ne $rawVersion) {
    $value = [string]$rawVersion
  }
  $value = $value.Trim()
  if ($value.StartsWith("v")) {
    $value = $value.Substring(1)
  }
  if ($value -notmatch "^\d+\.\d+\.\d+([\-+][0-9A-Za-z\.-]+)?$") {
    throw "Version format invalid: '$rawVersion'. Example: v3.0.2"
  }
  return $value
}

function Ensure-Directory([string]$path) {
  if (Test-Path -LiteralPath $path) {
    return
  }
  New-Item -ItemType Directory -Path $path | Out-Null
}

function Invoke-Step([string]$name, [scriptblock]$block) {
  Info "$name ..."
  & $block
  Info "$name done."
}

function Build-LatestYml(
  [string]$installerPath,
  [string]$assetName,
  [string]$version,
  [string]$outPath
) {
  $hashBytes = [System.Security.Cryptography.SHA512]::Create().ComputeHash(
    [System.IO.File]::ReadAllBytes($installerPath)
  )
  $sha512 = [System.Convert]::ToBase64String($hashBytes)
  $size = (Get-Item -LiteralPath $installerPath).Length
  $releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

  $content = @(
    "version: $version"
    "files:"
    "  - url: $assetName"
    "    sha512: $sha512"
    "    size: $size"
    "path: $assetName"
    "sha512: $sha512"
    "releaseDate: '$releaseDate'"
  ) -join "`n"

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outPath, $content, $utf8NoBom)
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Resolve-HotBaseUrl([string]$root, [string]$version, [string]$argValue) {
  if (-not [string]::IsNullOrWhiteSpace($argValue)) {
    return $argValue.Trim()
  }
  return "https://fudai.shuai.help/desktop/$version/"
}

function Update-PackageVersion([string]$root, [string]$version) {
  $pkgPath = Join-Path $root "package.json"
  $currentVersion = ""
  Push-Location $root
  try {
    $currentVersion = (& npm pkg get version --json)
    if ($LASTEXITCODE -ne 0) {
      throw "npm pkg get version failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
  if ([string]::IsNullOrWhiteSpace($currentVersion)) {
    throw "Failed to read version from package.json"
  }
  $currentVersion = $currentVersion.Trim().Trim('"')
  if ($currentVersion -eq $version) {
    Info "package.json already at $version"
    return
  }
  Info "sync package.json/package-lock.json version -> $version"
  & npm version $version --no-git-tag-version
  if ($LASTEXITCODE -ne 0) {
    throw "npm version failed with exit code $LASTEXITCODE"
  }
}

function Copy-ReleaseBackendFiles([string]$root, [string]$stagingDir) {
  $src = Join-Path $root "apps/pool-server"
  $items = @(
    "cmd",
    "internal",
    "sql",
    "static",
    ".dockerignore",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.redis.yml",
    "docker-compose.local.yml",
    "go.mod",
    "go.sum",
    "README.md",
    "config.json"
  )

  foreach ($item in $items) {
    $from = Join-Path $src $item
    if (-not (Test-Path -LiteralPath $from)) {
      continue
    }
    Copy-Item -LiteralPath $from -Destination $stagingDir -Recurse -Force
  }
}

function Get-GitCommit([string]$root) {
  Push-Location $root
  try {
    $commit = (& git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) {
      return "unknown"
    }
    return [string]$commit
  } finally {
    Pop-Location
  }
}

function Prepare-BackendReleaseBundle(
  [string]$stageDir,
  [string]$releaseVersion,
  [string]$releaseTag
) {
  $composePath = Join-Path $stageDir "docker-compose.yml"
  if (Test-Path -LiteralPath $composePath) {
    $compose = Get-Content -LiteralPath $composePath -Raw
    $compose = $compose.Replace('${POOL_IMAGE:-dy-pool-server:latest}', '${POOL_IMAGE:-dy-pool-server:' + $releaseVersion + '}')
    $compose = $compose.Replace('../../config.json:/app/config.json:ro', './config.json:/app/config.json:ro')
    Write-Utf8NoBom -path $composePath -content $compose
  }

  $deployShPath = Join-Path $stageDir "deploy-release.sh"
  $deployShTemplate = @'
#!/usr/bin/env bash
set -euo pipefail

VERSION="__RELEASE_VERSION__"
IMAGE_NAME="\${IMAGE_NAME:-dy-pool-server}"
IMAGE_TAG="\${IMAGE_TAG:-__RELEASE_VERSION__}"
POOL_PORT="\${POOL_PORT:-9090}"

echo "==> Building backend image \${IMAGE_NAME}:\${IMAGE_TAG}"
docker build -t "\${IMAGE_NAME}:\${IMAGE_TAG}" .

echo "==> Restarting pool-server container"
POOL_IMAGE="\${IMAGE_NAME}:\${IMAGE_TAG}" POOL_PORT="\${POOL_PORT}" docker compose up -d --force-recreate --remove-orphans

if command -v curl >/dev/null 2>&1; then
  echo "==> Health check"
  curl -fsS "http://127.0.0.1:\${POOL_PORT}/health" && echo
fi

echo "Done. tag=__RELEASE_TAG__ image=\${IMAGE_NAME}:\${IMAGE_TAG}"
'@
  $deploySh = $deployShTemplate.Replace("__RELEASE_VERSION__", $releaseVersion).Replace("__RELEASE_TAG__", $releaseTag)
  Write-Utf8NoBom -path $deployShPath -content $deploySh

  $deployPsPath = Join-Path $stageDir "deploy-release.ps1"
  $deployPsTemplate = @'
param(
  [string]$ImageName = "dy-pool-server",
  [string]$ImageTag = "__RELEASE_VERSION__",
  [int]$PoolPort = 9090
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "==> Building backend image $ImageName`:$ImageTag"
& docker build -t "$ImageName`:$ImageTag" .
if ($LASTEXITCODE -ne 0) {
  throw "docker build failed: $LASTEXITCODE"
}

Write-Host "==> Restarting pool-server container"
$env:POOL_IMAGE = "$ImageName`:$ImageTag"
$env:POOL_PORT = [string]$PoolPort
& docker compose up -d --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed: $LASTEXITCODE"
}

try {
  $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri "http://127.0.0.1:$PoolPort/health"
  Write-Host "Health: $($resp.StatusCode)"
} catch {
  Write-Warning "Health check failed: $($_.Exception.Message)"
}
'@
  $deployPs = $deployPsTemplate.Replace("__RELEASE_VERSION__", $releaseVersion)
  Write-Utf8NoBom -path $deployPsPath -content $deployPs

  $deployDocPath = Join-Path $stageDir "DEPLOY.md"
  $deployDocTemplate = @'
# Backend deploy (__RELEASE_TAG__)

Default compose image in this release is pinned to `__RELEASE_VERSION__`.
Use one of the helpers below so backend code and `/admin` page are always rebuilt from this package:

Linux/macOS:
  bash ./deploy-release.sh

Windows PowerShell:
  powershell -ExecutionPolicy Bypass -File ./deploy-release.ps1
'@
  $deployDoc = $deployDocTemplate.Replace("__RELEASE_VERSION__", $releaseVersion).Replace("__RELEASE_TAG__", $releaseTag)
  Write-Utf8NoBom -path $deployDocPath -content $deployDoc
}

function Get-GithubToken([string]$argValue) {
  if (-not [string]::IsNullOrWhiteSpace($argValue)) {
    return $argValue.Trim()
  }
  foreach ($name in @("GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT")) {
    $value = (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }
  return ""
}

function Publish-GitHubRelease(
  [string]$repo,
  [string]$tag,
  [string]$target,
  [string]$token,
  [string[]]$assetPaths
) {
  $headers = @{
    Authorization = "token $token"
    "User-Agent" = "dy-fudai-release"
    Accept = "application/vnd.github+json"
  }

  $release = $null
  try {
    $release = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  } catch {
    $payload = @{
      tag_name = $tag
      target_commitish = $target
      name = $tag
      draft = $false
      prerelease = $false
      generate_release_notes = $true
      make_latest = "true"
    } | ConvertTo-Json
    $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -ContentType "application/json" -Body $payload
  }

  $releaseId = [string]$release.id
  $patchPayload = @{
    target_commitish = $target
    name = $tag
    draft = $false
    prerelease = $false
    make_latest = "true"
  } | ConvertTo-Json
  Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repo/releases/$releaseId" -Headers $headers -ContentType "application/json" -Body $patchPayload | Out-Null

  $existingAssets = @($release.assets)
  foreach ($assetPath in $assetPaths) {
    $assetName = [System.IO.Path]::GetFileName($assetPath)
    $dups = $existingAssets | Where-Object { $_.name -eq $assetName }
    foreach ($dup in $dups) {
      Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($dup.id)" -Headers $headers | Out-Null
    }
  }

  $uploadBase = $release.upload_url.Replace("{?name,label}", "")
  foreach ($assetPath in $assetPaths) {
    $assetName = [System.IO.Path]::GetFileName($assetPath)
    $assetNameEscaped = [System.Uri]::EscapeDataString($assetName)
    $uploadUrl = "${uploadBase}?name=$assetNameEscaped"
    & curl.exe --http1.1 --fail-with-body -L -X POST `
      -H "Authorization: token $token" `
      -H "Content-Type: application/octet-stream" `
      --data-binary "@$assetPath" `
      "$uploadUrl" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Upload failed for $assetName (exit code $LASTEXITCODE)"
    }
  }

  $final = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  return $final
}

$releaseVersion = Normalize-Version -rawVersion $Version
$releaseTag = "v$releaseVersion"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..")).Path

$hotBaseUrlValue = Resolve-HotBaseUrl -root $root -version $releaseVersion -argValue $HotBaseUrl
$releaseDir = Join-Path $root "release-artifacts\$releaseTag"
$backendStageDir = Join-Path $releaseDir "pool-server"

$desktopDist = Join-Path $root "apps/desktop/dist"
$electronDist = Join-Path $root "apps/desktop/dist-electron"
$backendStaticRoot = Join-Path $root "apps/pool-server/static/desktop"
$backendStaticVersionDir = Join-Path $backendStaticRoot $releaseVersion

Invoke-Step "Version sync" {
  Update-PackageVersion -root $root -version $releaseVersion
}

Invoke-Step "Desktop build" {
  Push-Location $root
  try {
    & npm run desktop:build
    if ($LASTEXITCODE -ne 0) {
      throw "desktop:build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Invoke-Step "Hot manifest build" {
  Push-Location $root
  try {
    & npm run desktop:hot:manifest -- --base-url "$hotBaseUrlValue" --version "$releaseVersion" --min-app-version "$releaseVersion"
    if ($LASTEXITCODE -ne 0) {
      throw "desktop:hot:manifest failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Invoke-Step "Sync backend static desktop assets" {
  Ensure-Directory -path $backendStaticRoot
  if (Test-Path -LiteralPath $backendStaticVersionDir) {
    Remove-Item -LiteralPath $backendStaticVersionDir -Recurse -Force
  }
  Ensure-Directory -path $backendStaticVersionDir
  Copy-Item -Path (Join-Path $desktopDist "*") -Destination $backendStaticVersionDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $desktopDist "hot-manifest.json") -Destination (Join-Path $backendStaticRoot "hot-manifest.json") -Force
}

Invoke-Step "Build Windows installer" {
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  Push-Location $root
  try {
    & npx electron-builder --win nsis --x64 --publish never --config.extraMetadata.version="$releaseVersion" --config.win.signAndEditExecutable=false
    if ($LASTEXITCODE -ne 0) {
      throw "electron-builder failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$srcInstaller = Get-ChildItem -Path $electronDist -File | Where-Object { $_.Name -like "*$releaseVersion*setup.exe" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $srcInstaller) {
  throw "Could not find installer for version $releaseVersion under $electronDist"
}

$srcBlockmapPath = "$($srcInstaller.FullName).blockmap"
if (-not (Test-Path -LiteralPath $srcBlockmapPath)) {
  throw "Blockmap not found: $srcBlockmapPath"
}

Invoke-Step "Prepare release artifacts" {
  if (Test-Path -LiteralPath $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
  }
  Ensure-Directory -path $releaseDir
  Ensure-Directory -path $backendStageDir

  $installerAssetName = "dy-fudai-desktop-$releaseVersion-setup.exe"
  $blockmapAssetName = "dy-fudai-desktop-$releaseVersion-setup.exe.blockmap"
  $installerAssetPath = Join-Path $releaseDir $installerAssetName
  $blockmapAssetPath = Join-Path $releaseDir $blockmapAssetName
  $latestYmlPath = Join-Path $releaseDir "latest.yml"
  $hotZipPath = Join-Path $releaseDir "dy-fudai-hot-update-$releaseVersion.zip"
  $backendZipPath = Join-Path $releaseDir "dy-fudai-pool-server-$releaseVersion.zip"
  $manifestPath = Join-Path $releaseDir "release-manifest-$releaseVersion.json"

  Copy-Item -LiteralPath $srcInstaller.FullName -Destination $installerAssetPath -Force
  Copy-Item -LiteralPath $srcBlockmapPath -Destination $blockmapAssetPath -Force

  Build-LatestYml -installerPath $installerAssetPath -assetName $installerAssetName -version $releaseVersion -outPath $latestYmlPath

  Compress-Archive -Path (Join-Path $desktopDist "*") -DestinationPath $hotZipPath -CompressionLevel Optimal -Force

  Copy-ReleaseBackendFiles -root $root -stagingDir $backendStageDir
  Prepare-BackendReleaseBundle -stageDir $backendStageDir -releaseVersion $releaseVersion -releaseTag $releaseTag

  # Keep only current hot-update assets in backend package to avoid stale-version confusion.
  $stageDesktopRoot = Join-Path $backendStageDir "static/desktop"
  if (Test-Path -LiteralPath $stageDesktopRoot) {
    Get-ChildItem -LiteralPath $stageDesktopRoot -Directory | ForEach-Object {
      if ($_.Name -ne $releaseVersion) {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
      }
    }
  }

  $buildInfoPath = Join-Path $backendStageDir "BUILD_INFO.txt"
  $buildInfo = @(
    "version=$releaseVersion"
    "tag=$releaseTag"
    "built_at_utc=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))"
    "git_commit=$((Get-GitCommit -root $root).Trim())"
  ) -join "`n"
  Set-Content -LiteralPath $buildInfoPath -Value ($buildInfo + "`n") -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $backendStageDir "VERSION") -Value "$releaseTag`n" -NoNewline -Encoding UTF8
  Compress-Archive -Path (Join-Path $backendStageDir "*") -DestinationPath $backendZipPath -CompressionLevel Optimal -Force

  $manifest = [ordered]@{
    version = $releaseVersion
    tag = $releaseTag
    generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    hotBaseUrl = $hotBaseUrlValue
    assets = @(
      [ordered]@{ name = $installerAssetName; type = "desktop-installer" },
      [ordered]@{ name = $blockmapAssetName; type = "desktop-blockmap" },
      [ordered]@{ name = "latest.yml"; type = "desktop-latest-yml" },
      [ordered]@{ name = [System.IO.Path]::GetFileName($hotZipPath); type = "desktop-hot-update" },
      [ordered]@{ name = [System.IO.Path]::GetFileName($backendZipPath); type = "backend-package" }
    )
  } | ConvertTo-Json -Depth 5
  Set-Content -LiteralPath $manifestPath -Value ($manifest + "`n") -Encoding UTF8
}

$uploadAssetPaths = @(
  (Join-Path $releaseDir "dy-fudai-desktop-$releaseVersion-setup.exe")
  (Join-Path $releaseDir "dy-fudai-desktop-$releaseVersion-setup.exe.blockmap")
  (Join-Path $releaseDir "latest.yml")
)

$localOnlyAssetPaths = @(
  (Join-Path $releaseDir "dy-fudai-hot-update-$releaseVersion.zip")
  (Join-Path $releaseDir "dy-fudai-pool-server-$releaseVersion.zip")
  (Join-Path $releaseDir "release-manifest-$releaseVersion.json")
)

foreach ($path in ($uploadAssetPaths + $localOnlyAssetPaths)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing release asset: $path"
  }
}

if ($SkipGitHub) {
  Info "SkipGitHub enabled. Artifacts prepared at: $releaseDir"
  exit 0
}

$token = Get-GithubToken -argValue $GitHubToken
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "GitHub token missing. Provide -GitHubToken or set env GITHUB_TOKEN/GH_TOKEN/GITHUB_PAT."
}

$finalRelease = $null
Info "Publish GitHub release $releaseTag ..."
$finalRelease = Publish-GitHubRelease -repo $Repo -tag $releaseTag -target $Target -token $token -assetPaths $uploadAssetPaths
Info "Publish GitHub release $releaseTag done."
if ($null -eq $finalRelease -or -not ($finalRelease.PSObject.Properties.Name -contains "html_url")) {
  throw "Release publish verification failed: html_url not returned by GitHub API."
}
Info "Release URL: $($finalRelease.html_url)"
Info "Artifacts directory: $releaseDir"
