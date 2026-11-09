// One command to ship: `npm run dist` builds this OS's installers into out/builder.
// Forge builds the Vite output; electron-builder packs, signs and notarizes it.
import { execFileSync } from 'node:child_process';

const windows = process.platform === 'win32';
const run = (command, args) =>
  execFileSync(windows ? `${command}.cmd` : command, args, {
    stdio: 'inherit',
    shell: windows,
  });

// GitHub passes an unset secret as an empty string, which is not the same as absent.
for (const name of [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
])
  if (!process.env[name]) delete process.env[name];

const targets = windows
  ? ['--win']
  : process.platform === 'darwin'
    ? ['--mac']
    : ['--linux'];

// Fuses invalidate Electron's own signature, and Apple Silicon refuses to run
// unsigned code, so a build with no certificate is signed ad-hoc.
if (process.platform === 'darwin' && !process.env.CSC_LINK)
  targets.push(
    '-c.mac.identity=-',
    '-c.mac.hardenedRuntime=false',
    '-c.mac.notarize=false',
  );

run('npx', ['electron-forge', 'package']);
run('npx', [
  'electron-builder',
  '--config',
  'electron-builder.yml',
  '--publish',
  'never',
  ...targets,
]);
