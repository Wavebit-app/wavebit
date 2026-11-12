# wavebit

Desktop app: Electron Forge (Vite) + React 19 + TypeScript, HeroUI v3 on Tailwind v4, and a Rust native module built with napi-rs.

## Layout

- `src/main/` Electron main process.
  - `main.ts` boots the app. `window/mainWindow.ts` makes the frameless window (`titleBarOverlay`, remembered bounds). `window/tray.ts` is the system tray (its menu, pure and tested, in `trayMenu.ts`).
  - `security/` holds `security.ts` (permissions, navigation and window-open rules, including the Spotify login windows) `protocol.ts` (`app://wavebit` with its CSP, and `media://track|art/<id>` with Range support, readable by the app's own page only) and `urls.ts` (the URL and media-origin rules, pure and tested).
  - `ipc/` has `handle.ts` (`handle()` and `emit()`; only `wavebit:<code>` errors reach the page) and one file per domain: `app`, `settings`, `library`, `spotify`, `youtube`.
  - `auth/loginWindow.ts` the isolated sign-in window both services use.
  - `library/library.ts` owns the Rust `Library`, scans, folder picking and watching.
  - `spotify/` is the BitChord-style session: `session.ts` (isolated partition), `loginWindow.ts`, `token.ts` (token read from the web player through CDP), `clientToken.ts` (per-device token), `webPlayer.ts` (client version and persisted-query hashes from the bundle), `webapi.ts` (`/me`, `/me/playlists`, `/me/tracks` with that token), `pathfinder.ts` (persisted queries: the fallback for everything, plus Canvas, `getAlbum` and the library check, save and remove), `service.ts` (Web API first, Pathfinder when refused; cache keyed by `account_id`; matching).
  - `youtube/` is YouTube Music, after BitChord's Innertube: `session.ts` (partition, SAPISID, SAPISIDHASH), `innertube.ts` (the page's ytcfg scope, signed WEB_REMIX calls), `parse.ts` (home shelves, library cards, album and playlist pages), `service.ts` (status, home, library, pages, artists, save, the Spotify-to-YouTube `match`), `oauth.ts` (Google's desktop sign-in in the default browser: loopback + PKCE, tokens encrypted with the keyring) and `dataApi.ts` (YouTube Data API reads).
  - `updates/` is the in-app updater (electron-updater): `updates.ts` (checking, downloading, restarting into the installer, What's new, release details from GitHub) and `updateRules.ts` (pure and tested).
  - `downloads/` saves songs with the bundled yt-dlp and Deno: `downloads.ts` (queue, pacing, child process, moving files into the library), `downloadStore.ts` (what survives a restart, read as untrusted) and `downloadRules.ts` (arguments, filenames, folders, pacing, error meanings). The last two are pure and tested.
  - `lyrics/` finds a song's words: `repository.ts` (asks the enabled sources, caches per source), `choose.ts` (which answer wins; pure and tested), `providers.ts` and `lrclib.ts` (the services), `http.ts` (GETs limited to the services' hosts). `shared/lyricsSources.ts` lists them; `shared/lrc.ts` and `shared/lyricsParse.ts` parse them.
  - `services/` has `native.ts`, `settings.ts`, `windowState.ts`, `cache.ts`, `storageBackend.ts`, `listening.ts` (all-time listening per song; its rules, pure and tested, in `listeningRules.ts`), and `artCache.ts` (remote album covers on disk behind `media://remote/…`; its rules, pure and tested, in `artRules.ts`).
- `src/preload/preload.ts` the only bridge. It exposes `window.wavebit` and nothing else.
- `src/shared/` types and zod schemas used by both sides: `ipc/channels.ts` lists every channel and event, `ipc/api.ts` the bridge type, `schemas/` the inputs and DTOs, `errors.ts` the `wavebit:<code>` errors.
- `src/renderer/` React app.
  - `app/` the root, the state-based router (`router.ts`) and overlay state (`ui.ts`).
  - `layouts/` the shell: title bar and menus, the account avatars and Add folder in it (`ConnectLabels.tsx`), sidebar (and its Settings mode), floating bottom bar, shortcuts, the Update and What's new label (`UpdateLabel.tsx`), the resizable columns (`ResizeHandle.tsx`, `useColumns.ts`, `columnLimits.ts`), the sidebar's recent songs and artists (`SidebarLists.tsx`, its rules in `sidebarListRules.ts`).
  - `design/` shared pieces: Logo, Artwork, Backdrop, Empty, Segmented, SwitchRow, SideOrBottomSheet, Shelf (BitChord's horizontal rows), PickArt (the Top Picks gradients), PickCards (the tall cards Home and Library share), IconAction (bare icon actions and the List/Compact menu), WaveRing and StatusArt (the download ring and cover), ContextMenu (the right-click and long-press menu; `menuOn()` goes on `onContextMenu`), DetailsSheet (Show details).
  - `features/` one folder per area: downloads (`store.ts`, per-song status; the drawer; the header buttons), onboarding, home (feed and Top Picks), explore (YouTube Music's feed, moods and genres), library (`ListeningCards.tsx`; `DownloadsPage.tsx`, its grouping in `downloadGroups.ts`), spotify, youtube, player (two decks for files; `listenSampler.ts` the listening clock and `resumeRules.ts` where unfinished songs stopped, both pure and tested; `youtubeEmbed.ts` and `YouTubeStage.tsx` for streams; `NowPlayingPanel.tsx` the right drawer; `useArtworkTheme.ts`), search (`recentSearches.ts` the recent searches; its rules, pure and tested, in `recentRules.ts`), settings (`settingsIndex.ts` every setting's name, hint and search words; `rows.tsx`, `SettingsSearch.tsx`, `LyricsSourcesSheet.tsx`), menus (`menus.ts`: what each context menu offers).
  - `lib/` query hooks (`queries.ts`), theme, breakpoints, formatting, cover colours (`artPalette.ts`, pure and tested; `useArtColors.ts`). `styles/` tokens (`theme.css`) and base CSS.
- `native/` Rust crate (napi-rs): `cache.rs`, `library/` (scan, tags and ReplayGain, queries, `home.rs` Home's shelves and stations, `loudness.rs` EBU R128), `matcher.rs`. Builds `native/wavebit-native.node` and `native/index.d.ts`.
- `assets/brand/` logo SVGs and icons; `scripts/build-icons.mjs` renders the icons. `assets/build/` holds the macOS entitlements.
- `electron-builder.yml` packs, signs and publishes. `.github/` holds the workflows; `.github/RELEASING.md` explains releases and signing.
- `DESIGN.md` is the design spec; read it before changing anything visual.
- `docs/llms/` llms.txt files for HeroUI, TanStack, Electron Forge, React, Motion, Lucide, Zod and napi-rs. Read these before guessing an API.

## Commands

- `npm start` builds the Rust module, then runs the app with hot reload.
- `npm run check` typecheck, lint, JS tests (`node --test src/**/*.test.ts`) and Rust tests.
- `npm run dist` builds this OS's installers into `out/builder` (Forge builds Vite, electron-builder packs and signs).
- `npm run test:scripts` runs the release automation tests.
- `npm run native:build` rebuilds only the Rust module.
- `npm run tools:fetch` puts the pinned yt-dlp and Deno in `tools/`, checked by SHA-256 (runs before start, package and make). `npm run tools:update` pins the newest releases; do this and rebuild when YouTube breaks downloads.
- `npm run icons` re-renders the desktop icons (`icon.png`, `icon.ico`, `icon.icns`, `icons/`) from `logo-mark.svg`.
- `npm run banner` re-renders the README banner (`assets/brand/banner.png`) from `banner.html`.
- `WAVEBIT_USER_DATA=/some/dir npm start` runs against a throwaway profile (dev builds only).

## Rules

- New IPC: add the channel to `src/shared/ipc/channels.ts` and its type to `src/shared/ipc/api.ts`, a zod schema for its input in `src/shared/schemas/`, the handler through `handle()` in `src/main/ipc/<domain>.ts`, and the function in `src/preload/preload.ts`. Never expose `ipcRenderer` or Node APIs to the page.
- Network calls (Spotify) belong in the main process, through the Spotify partition's `session.fetch`, never in the renderer. The renderer CSP allows `connect-src 'self'` only.
- The Spotify and YouTube session cookies never leave Chromium's cookie jar, and the bearer token and SAPISID never cross IPC. The renderer only gets display data.
- Secrets never go to settings, logs or the cache DB. On Linux without a keyring the Spotify partition is in-memory only.
- Downloads never take cookies, and no tool path or address comes from the page or settings. Keep yt-dlp's `--ignore-config --no-plugin-dirs --no-exec`.
- Keep `contextIsolation`, `sandbox` and the fuses as they are. The fuses are declared in both `forge.config.mts` and `electron-builder.yml` and must match (a test checks).
- Commits and pull requests carry no `Co-Authored-By` trailer and no model or tool attribution of any kind: not Claude, not any other model or agent.
- Commits follow Conventional Commits. `feat:` and `fix:` subjects become the What's new text users read in the app, so write them for listeners.
- HeroUI is v3: compound components, no provider, `onPress` instead of `onClick`. A `Dropdown`'s trigger is the `Button` placed directly inside it (no `Dropdown.Trigger` wrapper, which renders a button of its own). Only `Switch.Content` is clickable, so `Switch.Control` goes inside it (`design/SwitchRow.tsx`). Use the `heroui-react` skill or the HeroUI MCP for component docs.
- No dividers: never use `Separator` or `border-*` lines between groups (DESIGN.md › Principles).
- TanStack Table is v9: `useTable({ features: tableFeatures({...}), columns, data })` and `<table.FlexRender>`.
- Framer Motion is imported from `motion/react`.

## Agent skills

Installed in `.claude/skills/` (pinned in `skills-lock.json`): ponytail, no-ai-slop, grill-me, electron-best-practices, electron (agent-browser), heroui-react, vercel-react-best-practices, vercel-composition-patterns. Restore them with `npx skills experimental_install`.
