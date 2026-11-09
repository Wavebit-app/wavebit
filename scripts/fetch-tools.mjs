// Puts the yt-dlp and Deno wavebit ships into tools/, for this OS and CPU only,
// each checked against the SHA-256 pinned in tools.lock.json.
//   npm run tools:fetch    what `npm start` and `npm run make` run first
//   npm run tools:update   pins the newest releases (no binaries are fetched)
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const lockFile = path.join(here, 'tools.lock.json');
const toolsDir = path.join(here, '..', 'tools');

const YT_DLP = 'https://github.com/yt-dlp/yt-dlp/releases/download';
const DENO = 'https://github.com/denoland/deno/releases/download';

const YT_DLP_FILES = {
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64',
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'darwin-x64': 'yt-dlp_macos',
  'darwin-arm64': 'yt-dlp_macos',
};
const DENO_FILES = {
  'linux-x64': 'deno-x86_64-unknown-linux-gnu.zip',
  'linux-arm64': 'deno-aarch64-unknown-linux-gnu.zip',
  'win32-x64': 'deno-x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'deno-aarch64-pc-windows-msvc.zip',
  'darwin-x64': 'deno-x86_64-apple-darwin.zip',
  'darwin-arm64': 'deno-aarch64-apple-darwin.zip',
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** A release's newest tag, from GitHub's redirect (no API token or rate limit). */
async function latestTag(repo) {
  const response = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: 'manual',
  });
  const tag = response.headers.get('location')?.split('/tag/')[1];
  if (!tag) throw new Error(`No latest release for ${repo}`);
  return tag;
}

async function update() {
  const ytTag = await latestTag('yt-dlp/yt-dlp');
  const sums = (await get(`${YT_DLP}/${ytTag}/SHA2-256SUMS`)).toString();
  const ytHash = (name) => {
    const hit = sums
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .find(([, file]) => file === name)?.[0];
    if (!hit) throw new Error(`${name} is not in SHA2-256SUMS`);
    return hit;
  };

  const denoTag = await latestTag('denoland/deno');
  const denoFiles = {};
  for (const [platform, name] of Object.entries(DENO_FILES)) {
    const text = (await get(`${DENO}/${denoTag}/${name}.sha256sum`)).toString();
    // Unix builds print "<hash>  <file>", Windows builds PowerShell's table.
    const hash = /\b[0-9a-f]{64}\b/i.exec(text)?.[0]?.toLowerCase();
    if (!hash) throw new Error(`No checksum for ${name}`);
    denoFiles[platform] = { name, sha256: hash };
  }

  const lock = {
    ytdlp: {
      version: ytTag,
      files: Object.fromEntries(
        Object.entries(YT_DLP_FILES).map(([platform, name]) => [
          platform,
          { name, sha256: ytHash(name) },
        ]),
      ),
    },
    deno: { version: denoTag, files: denoFiles },
  };
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Pinned yt-dlp ${ytTag} and Deno ${denoTag}`);
}

async function verified(url, expected) {
  const data = await get(url);
  const actual = sha256(data);
  if (actual !== expected)
    throw new Error(`${url}: expected ${expected}, got ${actual}`);
  return data;
}

/** The one named file of a zip, read through its central directory. */
function unzipEntry(zip, wanted) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a zip file');
  let at = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === wanted) {
      const method = zip.readUInt16LE(at + 10);
      const size = zip.readUInt32LE(at + 20);
      const local = zip.readUInt32LE(at + 42);
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const body = zip.subarray(start, start + size);
      return method === 0 ? Buffer.from(body) : inflateRawSync(body);
    }
    at +=
      46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${wanted} is not in the zip`);
}

function writeTool(file, data) {
  writeFileSync(file, data);
  chmodSync(file, 0o755);
}

const hashOf = (file) => (existsSync(file) ? sha256(readFileSync(file)) : null);

async function fetchTools() {
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  const platform = `${process.platform}-${process.arch}`;
  const yt = lock.ytdlp.files[platform];
  const deno = lock.deno.files[platform];
  if (!yt || !deno) throw new Error(`No tools pinned for ${platform}`);

  const exe = process.platform === 'win32' ? '.exe' : '';
  const ytPath = path.join(toolsDir, `yt-dlp${exe}`);
  const denoPath = path.join(toolsDir, `deno${exe}`);
  const stampPath = path.join(toolsDir, '.stamp.json');
  const stamp = existsSync(stampPath)
    ? JSON.parse(readFileSync(stampPath, 'utf8'))
    : {};
  mkdirSync(toolsDir, { recursive: true });

  if (hashOf(ytPath) !== yt.sha256) {
    console.log(`Fetching yt-dlp ${lock.ytdlp.version}`);
    writeTool(
      ytPath,
      await verified(`${YT_DLP}/${lock.ytdlp.version}/${yt.name}`, yt.sha256),
    );
  }

  // The lock holds the zip's hash, so the stamp remembers the binary it gave.
  const denoCurrent =
    stamp.denoZip === deno.sha256 && hashOf(denoPath) === stamp.denoBinary;
  if (!denoCurrent) {
    console.log(`Fetching Deno ${lock.deno.version}`);
    const zip = await verified(
      `${DENO}/${lock.deno.version}/${deno.name}`,
      deno.sha256,
    );
    const binary = unzipEntry(zip, `deno${exe}`);
    writeTool(denoPath, binary);
    writeFileSync(
      stampPath,
      JSON.stringify({ denoZip: deno.sha256, denoBinary: sha256(binary) }),
    );
  }

  copyFileSync(
    path.join(here, 'GPL-3.0.txt'),
    path.join(toolsDir, 'COPYING-yt-dlp.txt'),
  );
  writeFileSync(
    path.join(toolsDir, 'NOTICE.txt'),
    [
      `yt-dlp ${lock.ytdlp.version}: the packaged build is licensed under GPLv3 or later (see COPYING-yt-dlp.txt).`,
      `Source: https://github.com/yt-dlp/yt-dlp/tree/${lock.ytdlp.version}`,
      '',
      `Deno ${lock.deno.version}: MIT licensed.`,
      `Source: https://github.com/denoland/deno/tree/${lock.deno.version}`,
      '',
    ].join('\n'),
  );
}

try {
  await (process.argv.includes('--update') ? update() : fetchTools());
} catch (error) {
  console.error(`tools: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
