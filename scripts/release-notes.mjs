// A release's What's new, from its commits: `feat:` is New, `fix:` is Fixed. GitHub's
// generated notes only list merged pull requests, so direct pushes would leave it empty.
// wavebit shows this text in Settings › About (src/shared/releaseNotes.ts reads it).
import { execFileSync } from 'node:child_process';

const FIRST_RELEASE = '## New\n\n- First public release of wavebit\n';
const NOTHING_LISTED = '## Changes\n\n- Maintenance and small improvements\n';

export function notesFromCommits(subjects) {
  const groups = { New: [], Fixed: [] };
  for (const subject of subjects) {
    const match = /^(feat|fix)(?:\([^)]*\))?!?:\s+(.+)$/.exec(subject.trim());
    if (!match) continue;
    const [, type, text] = match;
    const line = text.charAt(0).toUpperCase() + text.slice(1);
    const group = groups[type === 'feat' ? 'New' : 'Fixed'];
    if (!group.includes(line)) group.push(line);
  }
  const sections = Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(
      ([title, items]) =>
        `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`,
    );
  return sections.length > 0 ? sections.join('\n') : NOTHING_LISTED;
}

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

export function releaseBody(sha) {
  let previous;
  try {
    previous = git(
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*',
      `${sha}^`,
    );
  } catch {
    return FIRST_RELEASE;
  }
  return notesFromCommits(
    git('log', '--format=%s', `${previous}..${sha}`).split('\n'),
  );
}
