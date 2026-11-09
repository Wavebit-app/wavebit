# Community automation

The workflows use GitHub metadata only. They do not check out code, run PR code, install packages, or interpolate issue or PR text into executable scripts. GitHub Script v8 is pinned to its upstream release commit (`ed597411d8f924073f98dfc5c65a23a2325f34cd`). Review Dependabot updates to action pins before merging.

## Issues

On an open issue, any human commenter can request assignment to themselves with a standalone `/assign` or `/assign @their-login` comment. Assigning someone else with `/assign @login` requires triage, write, maintain, or admin repository permission. Commands in edited comments, PR conversations, quoted text, or multi-line messages are ignored. Assignment remains subject to GitHub's assignee eligibility rules. Existing assignees are preserved; no command unassigns anyone. Permission failures and ineligible users are reported in the workflow log rather than generating comment noise.

When an issue is opened, the bot searches only this repository using up to three sanitized title words. It fetches at most six search results and suggests at most three related issues in one marked comment. Generic or short titles and empty results produce no comment. Reruns detect the existing bot comment. Suggestions may be wrong: a person must compare the reports. The bot never closes issues or applies labels based on similarity.

## Pull requests

Use a Conventional Commit title, such as `feat(player): add playback speed` or `fix(audio): recover disconnected devices`. Supported types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. Scopes and the breaking-change `!` marker are optional. Squash merge titles should retain this format for release tooling.

Include an existing issue in the PR description using a GitHub closing keyword:

- `Closes #123`
- `Fixes owner/repository#123`
- `Resolves https://github.com/owner/repository/issues/123`

Close/closes/closed, fix/fixes/fixed, and resolve/resolves/resolved are accepted without regard to case. References must point to an issue in this repository, not a PR. Repeat the keyword for each issue. Comments, fenced code, inline code, and quoted lines do not count. The validator checks at most ten unique issue references.

Maintenance PRs with a docs, build, ci, or chore title can omit an issue by adding a standalone `No-issue: <reason>` line to the description. The reason must have at least ten characters, for example `No-issue: Update development dependencies on the weekly schedule.` Feature and bug-fix PRs must link an issue. Dependabot PRs also need an issue or a maintainer-added exemption; they are not automatically exempt.

GitHub natively closes linked issues when a PR merges into the default branch. This automation never closes issues itself. PRs targeting another branch can pass the linking check, but their merge does not trigger default-branch issue closure. The policy runs again when the title/body changes or commits are pushed and reads the current PR metadata.

## Repository settings

1. Enable Actions and allow the pinned `actions/github-script` action. Keep default workflow permissions read-only. Job permissions grant only issue write access for community operations and issue/PR read access for validation. No repository secrets are required.
2. Merge these workflows into the default branch before expecting metadata events to run. `pull_request_target` deliberately uses trusted base-branch workflow code; never add a checkout of PR code or execute contributor-controlled inputs in this workflow.
3. Configure a branch ruleset for the default branch requiring the `PR policy` check and your build/test checks. Select the actual check after its first run. Require PRs and review for workflow changes. Administrators should test required-check behavior on a fork PR before enforcing it for everyone.
4. Enable squash merging and configure the default squash message to use the PR title. Preserve its conventional format when merging. Native closing keywords only close issues on merges into the default branch.
5. Enable Dependabot updates. Weekly Actions and npm updates are configured; automatic merging is not enabled by these files.

Run the metadata behavior tests locally with `node --test scripts/community.test.mjs`. The tests execute the actual inline scripts with mocked GitHub APIs; no credentials or network are required. YAML structure should also be checked when changing workflows.
