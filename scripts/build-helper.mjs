// Builds the helper behind Listen together's "Host on this device"
// (server/cmd/wavebit-p2p) into tools/, beside yt-dlp and Deno, for this OS
// and CPU. It is pure Go, so no C toolchain is needed.
//
// Without Go on PATH (or WAVEBIT_GO pointing at a go binary) it says so and
// stops without failing: the app then hides Host on this device. Release
// builds install Go first (see .github/workflows).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = path.join(
  root,
  'tools',
  process.platform === 'win32' ? 'wavebit-p2p.exe' : 'wavebit-p2p',
);
const go = process.env.WAVEBIT_GO || 'go';

const found = spawnSync(go, ['version'], { encoding: 'utf8' });
if (found.status !== 0) {
  if (process.env.WAVEBIT_REQUIRE_HELPER === '1') {
    console.error('build-helper: Go is required for this build.');
    process.exit(1);
  }
  console.log(
    'build-helper: Go isn’t installed, so Host on this device is left out of this build.',
  );
  // An older helper would no longer match this source.
  if (existsSync(out)) rmSync(out);
  process.exit(0);
}

mkdirSync(path.dirname(out), { recursive: true });
const built = spawnSync(
  go,
  [
    'build',
    '-trimpath',
    '-ldflags',
    '-s -w -buildid=',
    '-o',
    out,
    './cmd/wavebit-p2p',
  ],
  {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' },
  },
);
if (built.status !== 0) {
  console.error('build-helper: the helper didn’t build.');
  process.exit(built.status ?? 1);
}
console.log(`build-helper: ${path.relative(root, out)}`);
