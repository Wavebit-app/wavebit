import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tag = process.env.RELEASE_TAG;
const percentage = Number(process.env.STAGING_PERCENTAGE);
const repository = process.env.GITHUB_REPOSITORY;
if (
  !/^v?\d+\.\d+\.\d+$/.test(tag ?? '') ||
  !/^\d+$/.test(String(percentage)) ||
  percentage < 0 ||
  percentage > 100 ||
  !repository
) {
  throw new Error(
    'RELEASE_TAG, GITHUB_REPOSITORY, and STAGING_PERCENTAGE (0-100) are required',
  );
}

const gh = (...args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
const release = JSON.parse(
  gh('api', `repos/${repository}/releases/tags/${tag}`),
);
const assets = JSON.parse(
  gh('api', `repos/${repository}/releases/${release.id}/assets?per_page=100`),
);
const manifests = assets.filter((asset) =>
  /^latest(?:-linux|-mac)?\.yml$/.test(asset.name),
);
if (!manifests.length) throw new Error(`No update manifests found in ${tag}`);

const directory = mkdtempSync(path.join(os.tmpdir(), 'wavebit-rollout-'));
try {
  for (const asset of manifests) {
    const file = path.join(directory, asset.name);
    const content = execFileSync(
      'gh',
      [
        'api',
        '-H',
        'Accept: application/octet-stream',
        `repos/${repository}/releases/assets/${asset.id}`,
      ],
      {
        encoding: 'utf8',
      },
    );
    const withoutPrevious = content
      .replace(/^stagingPercentage:\s*\d+\s*$/m, '')
      .trimStart();
    writeFileSync(
      file,
      `stagingPercentage: ${percentage}\n${withoutPrevious}\n`,
    );
    gh('release', 'upload', tag, file, '--repo', repository, '--clobber');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  `Set ${tag} rollout to ${percentage}% across ${manifests.length} manifests`,
);
