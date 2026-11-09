# Contributing to wavebit

Open an issue before a new feature or a change to how wavebit talks to a service. Small fixes can go straight to a pull request. When reporting a bug, include your OS, wavebit version and the steps to reproduce it.

## Development

You need Node.js 22.18 or newer (CI uses 26), Rust stable and a C compiler. Then:

```sh
npm ci
npm start
```

`WAVEBIT_USER_DATA=/some/dir npm start` runs against a throwaway profile. Before opening a pull request:

```sh
npm run check
npm run test:scripts   # when changing the release automation
```

`npm run dist` builds this OS's installers into `out/builder`. On Linux it needs `rpm`.

`AGENTS.md` has the layout and rules, and `DESIGN.md` is the design spec: read it before changing anything visual. Keep IPC explicit and validated with zod, keep network calls in the main process, and never let session cookies or tokens reach the page.

## Pull requests

Use a Conventional Commit title such as `fix: keep the queue after a restart` or `feat: add playback speed`. `feat:` and `fix:` titles become the What's new text people read in the app, so write them for listeners. Explain the problem and how you tested it, add screenshots for visible changes, and link an issue with `Closes #123`. See the [automation rules](.github/AUTOMATION.md) for changes without an issue, and [RELEASING.md](.github/RELEASING.md) for how releases work.

Contributions are licensed under the repository's MIT license. Please follow the [community guidelines](CODE_OF_CONDUCT.md).
