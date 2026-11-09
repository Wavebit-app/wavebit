import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const platform = process.platform;
const arch = process.arch;
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const directory = 'out/builder';
const installers =
  platform === 'win32'
    ? ['.exe']
    : platform === 'darwin'
      ? ['.dmg', '.zip']
      : ['.AppImage', '.deb', '.rpm'];
const extensions = [...installers, '.blockmap', '.yml'];

// Top level only: electron-builder also leaves win-unpacked/ and the like here.
const artifacts = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter(
    (name) =>
      extensions.includes(path.extname(name)) &&
      (path.extname(name) !== '.yml' ||
        /^latest(?:-linux|-mac)?\.yml$/.test(name)),
  );

if (!artifacts.some((name) => /^latest(?:-linux|-mac)?\.yml$/.test(name)))
  throw new Error(`Missing update manifest in ${directory}`);
for (const extension of installers) {
  if (!artifacts.some((name) => name.endsWith(extension)))
    throw new Error(`Missing ${extension} installer`);
}

mkdirSync('release-assets', { recursive: true });
const names = new Set();
const checksums = [];
for (const artifact of artifacts) {
  const file = path.join(directory, artifact);
  const name = artifact.replace(/[^a-zA-Z0-9._+-]/g, '_');
  if (names.has(name)) throw new Error(`Duplicate artifact: ${name}`);
  names.add(name);
  copyFileSync(file, path.join('release-assets', name));
  checksums.push(
    `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${name}`,
  );
}
writeFileSync(
  `release-assets/SHA256SUMS-${platform}-${arch}-${version}.txt`,
  `${checksums.sort().join('\n')}\n`,
);
console.log(`Collected ${artifacts.length} artifacts for ${platform}/${arch}`);
