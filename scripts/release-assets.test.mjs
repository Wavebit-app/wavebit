import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-assets.mjs', import.meta.url));
const installers =
  process.platform === 'win32'
    ? ['.exe']
    : process.platform === 'darwin'
      ? ['.dmg', '.zip']
      : ['.AppImage', '.deb', '.rpm'];
const manifest =
  process.platform === 'win32'
    ? 'latest.yml'
    : process.platform === 'darwin'
      ? 'latest-mac.yml'
      : 'latest-linux.yml';

function fixture(run) {
  const root = path.resolve(`.release-test-${randomUUID()}`);
  mkdirSync(path.join(root, 'out', 'builder'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3' }),
  );
  try {
    run(root, path.join(root, 'out', 'builder'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const collect = (root) =>
  spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });

test('collects installers and the manifest, with verifiable checksums', () => {
  fixture((root, builder) => {
    for (const extension of installers)
      writeFileSync(
        path.join(builder, `wavebit${extension}`),
        `bytes ${extension}`,
      );
    writeFileSync(path.join(builder, manifest), 'manifest');
    const result = collect(root);
    assert.equal(result.status, 0, result.stderr);
    const directory = path.join(root, 'release-assets');
    const sums = readdirSync(directory).find((name) =>
      name.startsWith('SHA256SUMS'),
    );
    const lines = readFileSync(path.join(directory, sums), 'utf8')
      .trim()
      .split('\n');
    assert.equal(lines.length, installers.length + 1);
    for (const line of lines) {
      const [digest, name] = line.split('  ');
      assert.equal(
        createHash('sha256')
          .update(readFileSync(path.join(directory, name)))
          .digest('hex'),
        digest,
      );
    }
  });
});

test('leaves out unpacked folders and builder debug files', () => {
  fixture((root, builder) => {
    for (const extension of installers)
      writeFileSync(path.join(builder, `wavebit${extension}`), 'bytes');
    writeFileSync(path.join(builder, manifest), 'manifest');
    writeFileSync(path.join(builder, 'builder-debug.yml'), 'debug');
    mkdirSync(path.join(builder, 'win-unpacked'));
    writeFileSync(
      path.join(builder, 'win-unpacked', 'wavebit.exe'),
      'unpacked',
    );
    assert.equal(collect(root).status, 0);
    assert.equal(
      existsSync(path.join(root, 'release-assets', 'builder-debug.yml')),
      false,
    );
    assert.equal(
      readdirSync(path.join(root, 'release-assets')).filter((name) =>
        name.endsWith('.exe'),
      ).length,
      process.platform === 'win32' ? 1 : 0,
    );
  });
});

test('fails if a required installer is missing', () => {
  fixture((root, builder) => {
    writeFileSync(path.join(builder, manifest), 'manifest');
    const result = collect(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing .* installer/);
  });
});

test('fails if there is no update manifest', () => {
  fixture((root, builder) => {
    for (const extension of installers)
      writeFileSync(path.join(builder, `wavebit${extension}`), 'bytes');
    const result = collect(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing update manifest/);
  });
});

test('sanitizes unsafe characters in asset names', () => {
  fixture((root, builder) => {
    for (const extension of installers)
      writeFileSync(path.join(builder, `my wavebit${extension}`), 'bytes');
    writeFileSync(path.join(builder, manifest), 'manifest');
    assert.equal(collect(root).status, 0);
    for (const name of readdirSync(path.join(root, 'release-assets')))
      assert.match(name, /^[a-zA-Z0-9._+-]+$/);
  });
});
