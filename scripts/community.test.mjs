import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function script(name) {
  const text = readFileSync(
    new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  return new AsyncFunction(
    'github',
    'context',
    'core',
    text
      .split('          script: |\n')[1]
      .split('\n')
      .map((line) => line.replace(/^ {12}/, ''))
      .join('\n'),
  );
}
const community = script('community');
const policy = script('pr-policy');
function fixture({
  body = 'Fixes #12',
  title = 'fix: recover audio',
  command = '/assign',
  actor = 'alice',
  permission = 'read',
  existing = [],
  items = [],
  issueResult = {},
} = {}) {
  const calls = {
    assignments: [],
    comments: [],
    searches: [],
    failures: [],
    issues: [],
  };
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    eventName: 'issue_comment',
    payload: {
      pull_request: { number: 4 },
      issue: {
        number: 4,
        title: 'Microphone playback crashes',
        state: 'open',
        assignees: [],
      },
      comment: { body: command, user: { type: 'User', login: actor } },
    },
  };
  const github = {
    paginate: async () => existing,
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission } }),
      },
      pulls: { get: async () => ({ data: { body, title } }) },
      issues: {
        listComments() {},
        addAssignees: async (args) => calls.assignments.push(args),
        createComment: async (args) => calls.comments.push(args),
        get: async (args) => {
          calls.issues.push(args);
          if (issueResult.status) throw issueResult;
          return { data: issueResult };
        },
      },
      search: {
        issuesAndPullRequests: async (args) => {
          calls.searches.push(args);
          return { data: { items } };
        },
      },
    },
  };
  const core = {
    notice() {},
    setFailed: (message) => calls.failures.push(message),
  };
  return {
    calls,
    context,
    github,
    core,
    run: (fn) => fn(github, context, core),
  };
}
test('self assignment is allowed; assigning others requires permission', async () => {
  for (const [command, permission, expected] of [
    ['/assign', 'read', 1],
    ['/assign @alice', 'read', 1],
    ['/assign @bob', 'read', 0],
    ['/assign @bob', 'triage', 1],
    ['/assign @bob', 'write', 1],
    ['please /assign', 'admin', 0],
  ]) {
    const f = fixture({ command, permission });
    await f.run(community);
    assert.equal(f.calls.assignments.length, expected);
  }
});
test('existing assignment, bot and closed issue do nothing', async () => {
  for (const kind of ['assigned', 'bot', 'closed']) {
    const f = fixture();
    if (kind === 'assigned')
      f.context.payload.issue.assignees = [{ login: 'alice' }];
    if (kind === 'bot') f.context.payload.comment.user.type = 'Bot';
    if (kind === 'closed') f.context.payload.issue.state = 'closed';
    await f.run(community);
    assert.equal(f.calls.assignments.length, 0);
  }
});
test('related suggestions are bounded, same repo, and skip the current issue and PRs', async () => {
  const f = fixture({
    items: [
      { number: 4 },
      { number: 7, pull_request: {} },
      { number: 5 },
      { number: 6 },
      { number: 8 },
      { number: 9 },
    ],
  });
  f.context.eventName = 'issues';
  await f.run(community);
  assert.match(f.calls.searches[0].q, /^repo:owner\/repo is:issue in:title /);
  assert.equal(f.calls.searches[0].per_page, 6);
  assert.match(f.calls.comments[0].body, /- #5\n- #6\n- #8/);
  assert.doesNotMatch(f.calls.comments[0].body, /#9/);
});
test('reruns and empty searches do not spam', async () => {
  for (const existing of [
    [],
    [{ user: { type: 'Bot' }, body: '<!-- community-related-issues -->' }],
  ]) {
    const f = fixture({ existing });
    f.context.eventName = 'issues';
    await f.run(community);
    assert.equal(f.calls.comments.length, 0);
  }
});
test('closing keywords resolve real same-repository issues', async () => {
  for (const body of [
    'Closes #12',
    'FIXED owner/repo#12.',
    'Resolves https://github.com/owner/repo/issues/12',
  ]) {
    const f = fixture({ body });
    await f.run(policy);
    assert.equal(f.calls.failures.length, 0);
    assert.equal(f.calls.issues[0].issue_number, 12);
  }
});
test('nonclosing, cross-repository, hidden and nonexistent references fail', async () => {
  for (const body of [
    'Related #12',
    'Fixes other/repo#12',
    '`Fixes #12`',
    '```\nFixes #12\n```',
    '<!-- Fixes #12 -->',
    '> Fixes #12',
  ]) {
    const f = fixture({ body });
    await f.run(policy);
    assert.equal(f.calls.failures.length, 1, body);
  }
  for (const issueResult of [{ status: 404 }, { pull_request: {} }]) {
    const f = fixture({ issueResult });
    await f.run(policy);
    assert.equal(f.calls.failures.length, 1);
  }
});
test('maintenance exemption and conventional title requirements', async () => {
  for (const [title, body, expected] of [
    ['chore: update packages', 'No-issue: Update weekly dependencies.', 0],
    ['feat: new feature', 'No-issue: Update weekly dependencies.', 1],
    ['ci: checks', 'No-issue: short', 1],
    ['plain title', 'Fixes #12', 1],
    ['fix(audio)!: recover', 'Fixes #12', 0],
  ]) {
    const f = fixture({ title, body });
    await f.run(policy);
    assert.equal(f.calls.failures.length, expected);
  }
});
