import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error('Usage: node run-go.mjs --cwd <dir> <go args...>');
  console.error('Example: node run-go.mjs --cwd apps/pool-server run ./cmd/poolserver');
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

function run(goBin, argv, cwd, env) {
  return spawnSync(goBin, argv, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    env
  });
}

const argv = process.argv.slice(2);
let cwd = process.cwd();

if (argv[0] === '--cwd') {
  cwd = path.resolve(argv[1] || '');
  argv.splice(0, 2);
}

if (argv.length === 0) {
  usage();
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localGo = path.resolve(scriptDir, '.tools', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');

const goCache = path.resolve(scriptDir, '.go-build-cache');
const goPath = path.resolve(scriptDir, '.go-workspace');
const goModCache = path.resolve(goPath, 'pkg', 'mod');
ensureDir(goCache);
ensureDir(goModCache);

const env = {
  ...process.env,
  GOCACHE: process.env.GOCACHE || goCache,
  GOPATH: process.env.GOPATH || goPath,
  GOMODCACHE: process.env.GOMODCACHE || goModCache,
  GOPROXY: process.env.GOPROXY || 'https://goproxy.cn,direct',
  GOSUMDB: process.env.GOSUMDB || 'sum.golang.google.cn'
};

const candidates = [];
if (process.env.GO_BIN) candidates.push(process.env.GO_BIN);
candidates.push('go');
if (process.platform === 'win32') {
  candidates.push('C:/Program Files/Go/bin/go.exe');
  candidates.push('C:/Program Files (x86)/Go/bin/go.exe');
}
if (fs.existsSync(localGo)) candidates.push(localGo);

let result = null;
for (const goBin of candidates) {
  result = run(goBin, argv, cwd, env);
  if (!(result.error && result.error.code === 'ENOENT')) {
    break;
  }
}

if (result && result.error && result.error.code === 'ENOENT') {
  console.error('go not found: please install Go and ensure `go` is in PATH.');
  process.exit(127);
}

process.exit(result?.status ?? 1);
