import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseVersion(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? match.slice(1).map(Number) : null;
}

export function nextVersion(baseline, messages) {
  const version = parseVersion(baseline);
  if (!version) throw new Error(`Invalid baseline: ${baseline}`);
  const breaking = messages.some(
    (message) =>
      /^[a-z]+(?:\([^\r\n)]+\))?!:/m.test(message) ||
      /^BREAKING[ -]CHANGE:/m.test(message),
  );
  const feature = messages.some((message) =>
    /^feat(?:\([^\r\n)]+\))?:/m.test(message),
  );
  if (breaking) return `${version[0] + 1}.0.0`;
  if (feature) return `${version[0]}.${version[1] + 1}.0`;
  return `${version[0]}.${version[1]}.${version[2] + 1}`;
}

export function chooseRelease(releases, sha, resolveTag, isAncestor) {
  const stable = releases.filter(
    (release) => !release.prerelease && parseVersion(release.tag_name),
  );
  const same = stable.find(
    (release) =>
      resolveTag(release.tag_name) === sha ||
      (release.draft && release.target_commitish === sha),
  );
  if (same) return { current: same };
  const previous = stable
    .filter(
      (release) => !release.draft && isAncestor(resolveTag(release.tag_name)),
    )
    .sort((a, b) => {
      const av = parseVersion(a.tag_name);
      const bv = parseVersion(b.tag_name);
      return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
    })[0];
  return { previous };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function main() {
  const sha = process.env.GITHUB_SHA;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !repository)
    throw new Error('Missing release context');
  const pages = JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        '--paginate',
        '--slurp',
        `repos/${repository}/releases?per_page=100`,
      ],
      { encoding: 'utf8' },
    ),
  );
  const resolveTag = (tag) => {
    try {
      return git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
    } catch {
      return undefined;
    }
  };
  const isAncestor = (commit) => {
    if (!commit) return false;
    try {
      git('merge-base', '--is-ancestor', commit, sha);
      return true;
    } catch {
      return false;
    }
  };
  const { current, previous } = chooseRelease(
    pages.flat(),
    sha,
    resolveTag,
    isAncestor,
  );
  let version;
  let tag;
  if (current) {
    version = parseVersion(current.tag_name).join('.');
    tag = current.tag_name;
  } else {
    const baseline =
      previous?.tag_name ??
      JSON.parse(readFileSync('package.json', 'utf8')).version;
    const range = previous ? `${previous.tag_name}..${sha}` : sha;
    const messages = git('log', '--format=%B%x00', range).split('\0');
    // The first release is exactly what package.json says.
    version = previous ? nextVersion(baseline, messages) : baseline;
    tag = `v${version}`;
    const existingTagCommit = resolveTag(tag);
    if (
      (existingTagCommit && existingTagCommit !== sha) ||
      pages.flat().some((release) => release.tag_name === tag)
    ) {
      throw new Error(
        `Release ${tag} already belongs to another commit; refusing to overwrite it`,
      );
    }
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\ntag=${tag}\npublished=${Boolean(current && !current.draft)}\n`,
  );
  console.log(
    `${tag}: ${current && !current.draft ? 'already published; nothing to do' : 'build required'}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
