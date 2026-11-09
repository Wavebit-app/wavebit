import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const builder = read('electron-builder.yml');
const forge = read('forge.config.mts');

const NAMES = {
  RunAsNode: 'runAsNode',
  EnableCookieEncryption: 'enableCookieEncryption',
  EnableNodeOptionsEnvironmentVariable: 'enableNodeOptionsEnvironmentVariable',
  EnableNodeCliInspectArguments: 'enableNodeCliInspectArguments',
  EnableEmbeddedAsarIntegrityValidation:
    'enableEmbeddedAsarIntegrityValidation',
  OnlyLoadAppFromAsar: 'onlyLoadAppFromAsar',
  GrantFileProtocolExtraPrivileges: 'grantFileProtocolExtraPrivileges',
};

test('Forge and electron-builder set the same fuses', () => {
  for (const [forgeName, builderName] of Object.entries(NAMES)) {
    const value = new RegExp(
      `FuseV1Options\\.${forgeName}\\]: (true|false)`,
    ).exec(forge)?.[1];
    assert.ok(value, `${forgeName} is missing from forge.config.mts`);
    assert.match(builder, new RegExp(`^  ${builderName}: ${value}$`, 'm'));
  }
});

test('updates publish to the repository the app reads its notes from', () => {
  const updates = read('src/main/updates/updates.ts');
  const repo = /const REPO = '([^/]+)\/([^']+)'/.exec(updates);
  assert.match(builder, new RegExp(`^  owner: ${repo[1]}$`, 'm'));
  assert.match(builder, new RegExp(`^  repo: ${repo[2]}$`, 'm'));
});

test('the Windows installer stays one-click and reopens the app', () => {
  assert.match(builder, /^ {2}oneClick: true$/m);
  assert.match(builder, /^ {2}runAfterFinish: true$/m);
});

test('no two source files differ only by letter case', () => {
  // Windows and macOS disks can't tell them apart, so imports resolve wrongly.
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
  const stems = new Map();
  for (const file of walk(fileURLToPath(new URL('../src', import.meta.url)))) {
    const dir = path.dirname(file);
    const stem = path.basename(file).split('.')[0];
    const key = `${dir}/${stem}`.toLowerCase();
    assert.ok(
      !stems.has(key) || stems.get(key) === stem,
      `${file} collides with ${stems.get(key)}`,
    );
    stems.set(key, stem);
  }
});
