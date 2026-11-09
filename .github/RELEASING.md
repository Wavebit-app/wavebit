# Releasing wavebit

Pushing to `main` starts the release workflow. It reads stable GitHub release tags and the commits since the newest one. `feat:` makes a minor release, `!` or `BREAKING CHANGE:` a major one, and anything else a patch. The very first release uses the `package.json` version exactly. After that, the newest tag decides the next version and no version commit is pushed back.

The workflow runs CI on Windows, Linux and macOS. Each runner applies the planned version in its disposable checkout and runs `npm run dist`. A separate publisher job, the only one with `contents: write`, creates a draft release, uploads the verified files and publishes it. If any platform fails, nothing is published. A rerun on an already published commit changes nothing, and published files are never overwritten.

## What's new

The publisher writes the release body from the commits since the last tag: `feat:` goes under New and `fix:` under Fixed. wavebit shows that text in Settings › About, so **write commit subjects for listeners**, for example `feat: show lyrics in the mini player`. Commits of other types stay out of it.

## What ships

| Platform            | Installers                  | The updater uses                      |
| ------------------- | --------------------------- | ------------------------------------- |
| Windows x64         | NSIS one-click `.exe`       | `latest.yml`, `.exe`, `.blockmap`     |
| macOS Apple Silicon | `.dmg` and `.zip`           | `latest-mac.yml`, `.zip`, `.blockmap` |
| Linux x64           | `.AppImage`, `.deb`, `.rpm` | `latest-linux.yml`                    |

Each release also has `SHA256SUMS-*` files. Intel macOS, Windows ARM and Linux ARM aren't built: separately built architectures of one OS would overwrite each other's manifest, so adding one needs a step that merges them.

## Signing and notarization

Add these as repository secrets. Each platform turns on when its secrets exist, and builds still succeed without them. Pull requests never receive them.

**macOS** needs an Apple Developer ID certificate. In-app updates on macOS only work on a signed build; unsigned builds fall back to a Download update label that opens the Releases page.

| Secret             | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| `CSC_LINK`         | Base64 of the exported Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | That file's password                                   |
| `APPLE_API_KEY`    | Base64 of the App Store Connect `.p8` key              |
| `APPLE_API_KEY_ID` | The key's ID                                           |
| `APPLE_API_ISSUER` | The issuer ID                                          |

**Windows**, one of:

| Secret                                                      | Value                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                      | A code signing `.pfx` in Base64 and its password. EV certificates can't be used on CI.                                                 |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Azure Artifact Signing. Also add `win.azureSignOptions` to `electron-builder.yml` with your endpoint, account and certificate profile. |

Once Windows builds are signed, add `publisherName` under `publish` in `electron-builder.yml` so the updater also verifies who signed a download.

## Rollouts

The **Update rollout percentage** workflow rewrites `stagingPercentage` in a published release's manifests without rebuilding. Start small, then raise it to 100. To pull a bad release, publish a higher version.

## Rules

Use Conventional Commits. Action references are immutable commit SHAs: update them only after checking the upstream tag with `git ls-remote`, and update the comment beside them. PR workflows have read-only permissions, and untrusted PR code never runs with secrets or under `pull_request_target`.

To protect `main`, require pull requests and the `Lint, typecheck and tests` and three `Package (...)` checks.

Run the automation tests with `npm run test:scripts`.
