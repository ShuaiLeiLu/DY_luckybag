# Release Workflow

Current baseline version: `v3.0.1`.

From this version forward, each release must include:
- Windows installer assets (`.exe`, `.blockmap`, `latest.yml`)
- Desktop hot-update package
- Backend deployment package (with latest `static/desktop` hot resources)

## One-Command Release

Run from repo root:

```powershell
npm run release:publish -- -Version v3.0.2 -GitHubToken <YOUR_TOKEN>
```

Optional parameters:
- `-Repo ShuaiLeiLu/DY_luckybag` (default)
- `-Target main` (default)
- `-HotBaseUrl https://your-domain/desktop/3.0.2/` (if omitted, defaults to `https://fudai.shuai.help/desktop/<version>/`)
- `-SkipGitHub` (build/package only, no release upload)

## What The Script Does

1. Synchronizes `package.json`/`package-lock.json` version to the target version.
2. Builds desktop frontend and hot-manifest.
3. Syncs hot resources into `apps/pool-server/static/desktop/<version>`.
4. Builds Windows installer.
5. Generates release artifacts under `release-artifacts/<tag>/`:
   - `dy-fudai-desktop-<version>-setup.exe`
   - `dy-fudai-desktop-<version>-setup.exe.blockmap`
   - `latest.yml`
   - `dy-fudai-hot-update-<version>.zip`
   - `dy-fudai-pool-server-<version>.zip`
   - `release-manifest-<version>.json`
6. Creates/updates GitHub release tag and uploads only installer-related assets:
   - `dy-fudai-desktop-<version>-setup.exe`
   - `dy-fudai-desktop-<version>-setup.exe.blockmap`
   - `latest.yml`

The other files are local release artifacts only and are not uploaded to GitHub by default.

## Notes

- The script sets release as latest on GitHub.
- If asset names already exist in the same tag, they are replaced.
- Token can be provided by parameter or env var: `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT`.
