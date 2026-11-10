# wavebit design

wavebit is a desktop music player for Windows, Linux and macOS. It plays your own music files and shows your Spotify library, matched against those files. It is built with Electron, React 19, HeroUI v3 on Tailwind v4, Lucide and a Rust native module.

`src/renderer/styles/theme.css` implements the tokens and `src/renderer/design/` the shared pieces. When the code and this file disagree, this file states the intent and the code is the thing to fix.

## Principles

- **Flat and solid.** Solid colours only: no gradients, glows, glass or blur, with exceptions that are all made of artwork or are the reader's own choice: Home's Top Picks cards (see Home), the artwork backdrop, the still Mesh player theme, and Blur unfocused lyrics (off by default). _Why: artwork brings its own colour, and flat chrome keeps attention on it. The owner asked for the cards to look like BitChord's and the backdrop to be modern._
- **No dividers.** No separator lines, hairlines, rules or borders between groups, rows, panes or sections. Grouping comes from spacing, the size and weight of headings, and tonal fills (`canvas`, `surface`, `sunken`, `raised`). HeroUI's `Separator` is never used, and `--separator` and `--border` are transparent. The only outlines left are input fields, unselected radios and switches, and the keyboard focus ring, because those are controls, not dividers. _Why: the owner asked for no divider lines anywhere._
- **Cardless, content first.** Content sits directly on the surface. No `Card` around lists or sections. The exceptions are Settings: the theme picker and its inset groups (see Settings). _Why: boxes add padding around every list, and a music library is mostly lists._
- **Full height, edge to edge.** Every screen fills the window. The app draws its own title bar, and compact windows pad for safe areas and the on-screen keyboard. _Why: the window should feel like one workspace, not a page inside a frame._
- **Compact is its own layout.** Narrow windows share tokens, type, icons and copy with wide ones, but use phone patterns: bottom tabs, bottom sheets and large titles. _Why: a desktop layout squeezed into 400px is not a phone design._
- **Spotify is optional.** Everything except the Spotify pages works without signing in.

## Dials

| Dial   | Value | What it means here                                                                                     |
| ------ | ----- | ------------------------------------------------------------------------------------------------------ |
| ENERGY | 1     | Neutral surfaces, one accent, colour reserved for state and the primary action.                        |
| RHYTHM | 2     | An 8px spacing scale (4, 8, 12, 16, 24, 32, 48) and predictable page structure.                        |
| MOTION | 1     | The logo fade-in, sheet slide-in and state changes. Only a spinner and an active download's ring loop. |

## Palette

The light values are the owner's exact hex values. Components read Tailwind classes generated from these tokens (`bg-surface`, `text-muted`, `bg-accent`), never raw hex.

| Token          | Light     | Dark      | HeroUI variable it sets                                  |
| -------------- | --------- | --------- | -------------------------------------------------------- |
| `canvas`       | `#eef0f3` | `#0b0b0d` | `--background`                                           |
| `surface`      | `#ffffff` | `#131316` | `--surface`                                              |
| `sunken`       | `#f5f6f8` | `#0f1012` | `--surface-secondary`, `--field-background`, `--default` |
| `raised`       | `#ffffff` | `#1d1e23` | `--overlay` (menus, popovers, sheets in dark)            |
| `line`         | `#dde1e7` | `#222327` | `--field-border` only                                    |
| `line-strong`  | `#c6ccd5` | `#32343a` | `--field-border-hover`, switch and radio outlines        |
| `ink`          | `#14161a` | `#f1f1f3` | `--foreground`, `--surface-foreground`                   |
| `muted`        | `#5b6270` | `#a8adb7` | `--muted`, `--field-placeholder`                         |
| `faint`        | `#8a919c` | `#7e838f` | `--color-faint` (line art only)                          |
| `accent`       | `#2f5bea` | `#7f95ff` | `--accent`, `--focus`, `--link`                          |
| `accent-hover` | `#2549c4` | `#98a9ff` | `--accent-hover`                                         |
| `accent-soft`  | `#e6ecfd` | `#1f2540` | `--accent-soft`                                          |
| `on-accent`    | `#ffffff` | `#0d1020` | `--accent-foreground`                                    |
| `record`       | `#d93a2b` | `#ff6f64` | `--color-record`                                         |
| `success`      | `#1f8a4c` | `#4fce87` | `--success`                                              |
| `success-soft` | `#e3f3ea` | `#143022` | `--success-soft`                                         |
| `warning`      | `#a86a12` | `#e7b45a` | `--warning`                                              |
| `warning-soft` | `#fbf0dc` | `#32260f` | `--warning-soft`                                         |
| `danger`       | `#c4322b` | `#ff6f64` | `--danger`                                               |
| `danger-soft`  | `#fbe6e5` | `#3a1d1b` | `--danger-soft`                                          |

`--accent-soft-foreground` is `accent`. `--danger-foreground` is white in light and `#0d1020` in dark. `--backdrop` (the scrim) is `ink` at 48%. `--separator`, `--separator-secondary`, `--separator-tertiary`, `--border`, `--border-secondary` and `--border-tertiary` are `transparent`. Tailwind v4 has no config file: `theme.css` is the Tailwind config, and its `@theme` block adds the tokens HeroUI lacks (`canvas`, `sunken`, `raised`, `faint`, `record`).

### Accent tones

Blue is the default. The other tones override four tokens, set on `<html data-accent="…">`.

| Tone   | Mode  | `accent` | `accent-hover` | `accent-soft` | `on-accent` |
| ------ | ----- | -------- | -------------- | ------------- | ----------- |
| violet | light | #6148d8  | #5038b8        | #ece8ff       | #ffffff     |
| green  | light | #1f8a4c  | #267b47        | #e3f3ea       | #ffffff     |
| amber  | light | #ba7400  | #9f6600        | #f7edda       | #241603     |
| rose   | light | #c14574  | #a73b64        | #f9e7ee       | #ffffff     |
| violet | dark  | #a28fff  | #b7a8ff        | #30254b       | #0f0820     |
| green  | dark  | #4fce87  | #6fdaa0        | #153025       | #081d12     |
| amber  | dark  | #e7b45a  | #efc680        | #38280f       | #241603     |
| rose   | dark  | #ff83ad  | #ff9fc0        | #3c1d2b       | #260d17     |

Light amber is the only tone with dark text on the accent fill. _Why: white on #ba7400 is too weak, and #241603 reads clearly on it._

### Roles

- `canvas` is the app frame: the title bar, sidebar, rail and player bar. `surface` is the workspace. `sunken` is for inputs, hovered rows, icon tiles and artwork placeholders. `raised` is for anything that opens over the page; in dark it sits a step above `surface` so a menu never blends into the page under it.
- `ink` is primary text. `muted` is descriptions, metadata and secondary labels.
- `faint` is for line art and decorative strokes. **It is never text.**
- `accent` marks the primary action, the selection, the playing row and focus. One primary action per view.
- A selected nav item or row is an `accent-soft` fill with `accent` icon and label, never a coloured strip on its edge.
- `success`, `warning`, `danger` and `record` are for state only, never decoration.

## Contrast

WCAG 2.x ratios. AA is 4.5:1 for normal text and 3:1 for large text and non-text UI.

### Light

| Pairing                                | Ratio                  | Result             |
| -------------------------------------- | ---------------------- | ------------------ |
| ink on surface / sunken / canvas       | 18.11 / 16.75 / 15.86  | AA                 |
| muted on surface / sunken / canvas     | 6.13 / 5.67 / 5.37     | AA                 |
| muted on accent-soft                   | 5.19                   | AA                 |
| faint on surface / sunken / canvas     | 3.18 / 2.94 / 2.78     | Not text           |
| accent on surface / canvas             | 5.52 / 4.83            | AA                 |
| on-accent on accent / accent-hover     | 5.52 / 7.42            | AA                 |
| accent on accent-soft                  | 4.67                   | AA                 |
| success on surface                     | 4.38                   | Accepted exception |
| warning on surface                     | 4.43                   | Accepted exception |
| success on success-soft                | 3.81                   | Below AA           |
| warning on warning-soft                | 3.93                   | Below AA           |
| danger on surface / danger-soft        | 5.47 / 4.57            | AA                 |
| line-strong (switch, radio) on surface | 3.72 light / 3.63 dark | AA (non-text)      |

### Dark

| Pairing                               | Ratio              | Result                       |
| ------------------------------------- | ------------------ | ---------------------------- |
| ink on surface / canvas               | 16.44 / 17.43      | AA                           |
| muted on surface / canvas / sunken    | 8.24 / 8.73 / 8.45 | AA                           |
| ink / muted on raised                 | 14.75 / 7.39       | AA                           |
| muted on accent-soft                  | 6.68               | AA                           |
| faint on surface / canvas             | 4.88 / 5.18        | AA (still not used for text) |
| accent on surface / accent-soft       | 6.75 / 5.47        | AA                           |
| on-accent on accent / accent-hover    | 6.87 / 8.50        | AA                           |
| success / warning / danger on surface | 9.28 / 9.78 / 6.81 | AA                           |

Every accent tone's on-accent pairing passes AA in dark (7.35 to 10.96).

### More contrast

Settings › Appearance › More contrast changes three tokens and nothing else. Light: `line` #b8bfca, `line-strong` #7c8594, `muted` #464c58 (8.62:1). Dark: #3a3d44, #6a6e78, #c6cad2 (11.29:1).

### Rules that follow from the numbers

- **Accepted exception.** Success, warning and the green accent at 4.38 to 4.43:1 on white always come with an icon or weight 600.
- **faint is never text**, including placeholders, timestamps and disabled labels. Use `muted`.
- **Open items.** Success and warning on their soft fills and light amber as text are below 4.5:1. Soft-fill badges use `ink` text with a coloured icon, and the amber accent is never a text colour in light mode.

## Layout

Hierarchy is **Page → Section → Component**. A page has one title. Sections are separated by 32px of space and a `titleSmall` heading (15px, 600). Rows inside a section are separated by 4px of space and their hover fill, never a line.

### Breakpoints

| Name     | Window width | Navigation               | Sheets         |
| -------- | ------------ | ------------------------ | -------------- |
| Compact  | under 600px  | bottom tab bar           | bottom `Sheet` |
| Medium   | 600 to 899px | 72px rail                | side `Drawer`  |
| Expanded | 900px and up | 232px sidebar (foldable) | side `Drawer`  |

The welcome screen switches from stacked to split at 840px. `src/renderer/lib/useBreakpoint.ts` is the only place these numbers live in code.

### Expanded and medium

- **Title bar.** 48px, `canvas`, drawn by the app (`titleBarStyle: 'hidden'`). It is a drag region (`-webkit-app-region: drag`); everything clickable inside it opts out. Three zones:
  - **Left:** the 22px logo mark, then Back and Forward (28px icon buttons), then the menus File, Edit, View, Playback and Help as 28px text buttons (`ink`, 13px, 500; the open one on `sunken`). A menu drops 4px below the bar as a `raised` panel with 6px corners and the overlay shadow, no border. Each item has its shortcut as a `Kbd` on the right, and items are grouped by 8px of space, never by a separator line.
  - **Centre:** the search pill ("Search your music", Ctrl K), 38px tall and at most 400px wide, then the Explore icon (Lucide's Telescope at 24px in a 38px square, Page actions, `accent` while on Explore) right after it. The two sit centred on the window. Wide labels on the right may nudge them left rather than run under them.
  - **Right:** the connect labels (`layouts/ConnectLabels.tsx`), then the native window controls from `titleBarOverlay` on Windows and Linux, coloured `canvas` and `ink` and updated when the theme changes. On macOS the traffic lights sit on the left, the logo moves 72px right and the menus go to the system menu bar.
  - **Update label** (`layouts/UpdateLabel.tsx`), first among the connect labels and hidden the rest of the time: the wave ring and "Updating 42%" while downloading (a press opens About), "Restart to update" on `accent` once ready (a press closes wavebit, installs and reopens it), "Restarting…" just after, "Download update" on `accent-soft` where an unsigned macOS build can't update itself (a press opens Releases), and "What's new" on `accent-soft` after an update has installed (a press opens About at What's new and removes the label; a newer update's states take its place). _Why: the owner asked for the update to be visible in the title bar, just before the account icons._
  - **Connect labels:** Spotify, YouTube Music and Add folder as bare 18px icons (Page actions) with a tooltip, each in a 32px clickable square, directly before the window controls, at every window width. Each shows only while that thing is missing and goes away by itself: Spotify until signed in (a press opens its sign-in window), YouTube Music until signed in (a press opens Settings › YouTube Music, where its OAuth client is entered), Add folder until the library has a folder (a press opens the folder picker). Not shown during welcome and setup, which have these as steps. _Why: the owner asked for these in the title bar instead of as banners on the page, as icons with no wrapper._
  - Below 1000px the menus fold into one 28px "Menu" icon button that opens the same lists, and the search pill narrows to 280px, so the zones never overlap. The bar is a three-column grid whose side columns never shrink below their content, which is what guarantees that.
  - _Why: native controls keep snap layouts and accessibility, and drawing the bar ourselves removes the white system frame and gives the menus and search a home that never scrolls away._
- **Pull to refresh.** On every page but Settings: at the top of the page, keep scrolling up with a wheel or touchpad, or swipe down on a touch screen. The page opens downward with an arrow that flips once it has been pulled far enough (64px after damping), then shows a spinner while the page reads again. A wheel refreshes as soon as it passes that point; a swipe when it lets go. A scroll that was already moving when it reached the top doesn't count. It clears that page's Spotify and YouTube Music caches (and rescans the folders on Library), at most once in 10 seconds per kind of page.
- **Menus.** File: Add music folder (Ctrl O), Rescan library (F5), Quit (Ctrl Q). Edit: Find in this list (Ctrl F), Search your music (Ctrl K). View: Home (Ctrl 1), Library (Ctrl 2), Explore (Ctrl 3), Settings (Ctrl ,), Fold sidebar (Ctrl B), then the themes. Playback: Play or pause (Space), Next (Ctrl Right), Previous (Ctrl Left), Shuffle (Ctrl S), Repeat (Ctrl R), Volume up and down. Help: About wavebit, Keyboard shortcuts (Ctrl /), Licences. During welcome and setup only the logo and the window controls show, because nothing else has a destination yet. Every item does something real.
- **Resizing** (`ResizeHandle.tsx`, `useColumns.ts`, its limits, pure and tested, in `columnLimits.ts`). The sidebar and the right panel each resize from their edge, after the ARIA window splitter pattern: the sidebar 200 to 360px (232 to begin with), the panel 300 to 520px (360 to begin with).
  - **Limits:** dragging never leaves the workspace under 480px, and the sidebar grows past 232px only while the player bar keeps 1000px for its three groups. A window too narrow for the choice draws less (the panel gives way first, then the sidebar) and gives it back when the window grows. The rail, phone widths and the full-screen player have no handle.
  - **The handle:** an 8px strip astride the edge with nothing drawn at rest (no dividers). After 200ms of hover, on keyboard focus or during a drag it shows a 2px `accent` line. The pointer is captured so a drag carries on over the video, and the cursor stays `col-resize`.
  - **Keys and reset:** Left and Right move it 16px (64 with Shift), Home and End go to the limits, Enter or a double click returns to the first width. Widths are remembered on this computer.
- **Sidebar.** 232px to begin with, `canvas`, full height under the title bar. A fold button, then Home, Explore, Library and Settings (36px items, 18px icons). There is no Spotify page, as in BitChord: Spotify's playlists live here and in Library. Under them, one scrolling list (`SidebarLists.tsx`, after BitChord's web sidebar) while the main links stay put, each section paged with Show more:
  - **Playlists** (once Spotify is connected; 6 a page): Liked Songs first, each a 48px row with a 36px cover (4px corners) and its name. Settings › Appearance can hide them.
  - **Recently played** (8 a page): the song playing first even before it counts as a play, then wavebit's own history, as 56px rows with a 44px cover, title and artist. A press plays it; on the playing song it pauses or resumes. A right-click is the song's menu.
  - **Artists** (6 a page): everyone in that list once, latest first, by their first credit, as 52px rows with a 40px circle. A streamed artist's photo comes from YouTube Music and opens their page. _An artist heard from a file shows a cover and opens the library's page, so the names in someone's files are never sent anywhere._
  - **What's playing:** three `accent` bars at the end of the song's row, its artist's and the playlist it came from (`PlayingBars.tsx`). They move while it plays and hold still when paused or with Motion below Full.

  The fold button collapses the sidebar to the rail and the choice is remembered.

- **Settings replaces the sidebar.** Opening Settings swaps the sidebar's contents in place: a "Settings" row with a back arrow at the top (it returns to the page you came from, as does Escape), the Search settings field, then the sections as 36px items with icons, styled like the main links: **General** (Appearance, Playback, Content preferences, Downloads, Library) and **Accounts** (Spotify, YouTube Music) under `muted` 12px headings, with About and the version at the foot. Groups are separated by space, never a line. Typing replaces the sections with results. The page itself has no second, inline section list. _Why: the owner asked for one navigation column at a time, so Settings never shows two lists side by side._
- **Rail.** 72px, `canvas`: 48×40px icon items with tooltips and no labels. Under them the sidebar's lists stay, as pictures in the same order: playlists, recently played and artists at 48px (artists round) in a 56px clickable square, each with its name as a tooltip and the same press and right-click as its row. Groups are separated by a 12px gap, the list scrolls with no bar, Show more is a chevron, and what's playing has the bars over its picture. _Why: the owner asked that folding the sidebar keep what was just played in view, and that the pictures be large enough to see._ In Settings the rail shows the section icons in the same groups and a back arrow; the search field moves to the top of the page.
- **Workspace.** `surface`, with 6px corners at the top left and bottom left where it meets the `canvas` frame. No border: the tone change from `canvas` is the edge.
- **Player bar.** 76px, `canvas`, under the workspace only (the sidebar runs the full height beside it). Three groups: artwork (48px, 6px corners), title and artist on the left; shuffle, previous, play, next and repeat over the seek bar in the true centre; the Now playing drawer, lyrics, queue, volume and the full-screen player button on the right. An active shuffle or repeat is its icon in `accent`. Hidden while nothing has been played. _Why: the sidebar keeps its full height for playlists, and the bar sits under what it plays._
- **Content width.** Centred up to 1160px. Side padding 24px, 40px from 1100px wide.

### Compact

- **Top bar, then large title.** A 56px top bar (the way back, or the logo mark on top-level pages, and the page's actions on the right), then the 28px title and a `muted` line under it.
- **Floating tab bar.** Home, Explore, Library, Settings in a fully rounded 64px pill, `raised`, with the overlay shadow and no border, 16px from the window sides and 12px above the bottom safe-area inset. 8px inside, 4px between items. The selected tab has a fully rounded 56×32px `accent-soft` indicator behind its icon and an `accent` label at 600. Pages scroll beneath it and leave its height plus 24px after their last row. _Why: the owner asked for the floating bar from crabshare's phone design; it stays solid, with no glass, under the flat rule._
- **Mini player.** A 60px `raised` card with 16px corners and the overlay shadow, 8px above the tab bar with the same side margins: 40px artwork, title and artist, Play, Next, and a 2px `accent` progress line along its bottom edge inside the corners. A tap opens the full-screen player.
- **These two and the menus** are the only floating elements, and the only ones with a shadow.
- **Safe areas.** `index.html` sets `viewport-fit=cover`. Bars pad with `env(safe-area-inset-*)`. _Why: touch laptops and tablets running the app full screen report insets, and future phone builds will too._
- **On-screen keyboard.** The renderer sets `navigator.virtualKeyboard.overlaysContent = true` where the API exists. Anything pinned to the bottom (sheets, the tab bar, the mini player) moves up by `env(keyboard-inset-height, 0px)`, so a text field is never covered. Search fields scroll themselves into view on focus.

## Components

HeroUI v3 is the component library. Each pattern has one component.

| Pattern                           | HeroUI component                                       | Notes                                          |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Primary, secondary, quiet actions | `Button` (`primary`, `secondary`, `tertiary`, `ghost`) | One `primary` per view.                        |
| Side sheet (expanded, medium)     | `Drawer`, `placement="right"`                          | At most 400px or 85% of the window.            |
| Bottom sheet (compact)            | `Sheet`, `placement="bottom"`                          | With `Sheet.Handle`.                           |
| Both at once                      | `design/SideOrBottomSheet.tsx`                         | Picks one from the breakpoint.                 |
| Short result of an action         | `Toast` via `toast()`                                  | Bottom right, or above the tab bar in compact. |
| Menus                             | `Dropdown`                                             | `raised`, 6px corners, a soft shadow.          |
| Context menus                     | `Dropdown` at the pointer (`design/ContextMenu.tsx`)   | The same surface, an icon on every row.        |
| Tonal group                       | `Surface variant="secondary"`                          | `sunken` fill, no border, used sparingly.      |
| Empty state                       | `EmptyState` + `design/EmptyArt.tsx`                   | See Empty states.                              |
| Waiting                           | `Spinner`, `Skeleton`                                  | See Loading.                                   |
| Inline errors                     | `Alert`                                                | Icon first, under the thing that failed.       |
| Choices                           | `ToggleButtonGroup`, `Switch`, `RadioGroup`            | Segmented controls are `ToggleButtonGroup`.    |
| Keyboard hints                    | `Kbd`                                                  |                                                |
| Icon-only buttons                 | `Tooltip` around `Button isIconOnly`                   | Always with an `aria-label`.                   |
| Page actions                      | `design/IconAction.tsx`                                | The icon alone; see Page actions.              |

**Never used:** `Modal` and `AlertDialog` centred on the window (decisions go in a sheet or inline), `Card` (except the theme picker) and `Separator`.

### Page actions

The row under an album, playlist, artist or song title, and the title bar's connect labels (`IconAction`). _Why: the owner asked for icons with no button around them._

- **The icon alone.** No fill, border or frame, hovered or pressed: the icon goes to 70% opacity on hover and 50% pressed. Each is still a real button with an `aria-label`, a tooltip and the focus ring, and its whole square takes the click.
- **Play** is the large one: a 52px `CirclePlay` in `accent`, 56px square. The rest are 24px in `ink` in a 40px square: Shuffle, Add to queue, Save (`accent` and filled when saved), Add to your playlists, Remove, and Open in Spotify or YouTube Music (the service's own mark).
- **The view menu** comes last, after Open in: a `Dropdown` with **List** and **Compact**, a check on the current one. It is the same setting as Settings › Appearance › Song rows, so every song list follows it. List rows are 56px with 40px artwork, Compact 44px with 30px artwork. It is on album, playlist and artist pages and Library's Songs toolbar.

### Side sheet and bottom sheet

- A title (20px, 600) and a Close icon button with a tooltip, a scrolling body, and optional actions at the bottom, separated by 16px of space.
- Escape, Back and a click on the scrim close it. Focus moves into it and stays there while it is open. It slides in over 250ms, instantly with Motion off.
- A bottom sheet pads for the navigation inset and the on-screen keyboard.

## Shape

- **Every corner is 6px** (`--radius`). Buttons, inputs, menus, sheets (inner corners), tooltips, the workspace corner and icon tiles. Home's Top Picks cards and Library's listening cards are 12px, as BitChord's are.
- **Inner parts are 4px.** A segmented thumb, a menu highlight, a tag inside a row.
- **Artwork is 4px** in rows and 6px in grids and the player.
- **Circles only where the shape means something:** the Spotify avatar, radio buttons and the setup step markers (a number, or a check once done).
- **Pills, and only these:** search fields (38px in the title bar, 40px in a page, 48px in compact), the buttons on the welcome and setup screens (48px desktop, 52px compact), the floating tab bar and its indicator. Every other button keeps 6px corners. _Why: the owner asked for fully rounded welcome buttons and search fields only, so the first screens feel friendlier without turning the whole app into pills._
- **The mini player is 16px corners**, after the floating bar it sits on.

## Type

- **Inter** (`@fontsource-variable/inter`), bundled so it works offline and passes the CSP.
- **15px base**, 14px for dense rows.
- **Headings** are 600 with -0.01em tracking. Page titles 26px desktop, 28px compact.
- **Descriptions** are `muted` at regular weight. Durations, counts and dates use tabular figures (`tabular-nums`).

## Icons

- **Lucide** (`lucide-react`). Line icons only: 16px in buttons, 18px in the sidebar and rows, 20 to 22px in compact tabs and tiles.
- Icons inherit `currentColor`. A decorative icon has `aria-hidden`. An icon-only button has an `aria-label` and a tooltip.

## Service marks

Spotify and YouTube Music appear as themselves wherever wavebit names them: Settings' section list, the account row (the person's own picture when the service has one, else the mark), Connect buttons and "Open in Spotify" / "Open in YouTube Music". The marks are Simple Icons' (CC0) in each brand's colour (`--color-brand-spotify`, `--color-brand-youtube`), or one colour (`mono`) on a filled button. They are never recoloured with the accent. `design/BrandMarks.tsx`.

## About and updates

Settings › About shows the version with GitHub's mark beside it (it opens the repository), then **Updates** (one row with the state and its action, the details of a waiting version under it, and Update automatically), then **What's new** for the installed version with New and Fixed lists and a link to the full notes. Details come live from the GitHub release and a copy is kept on the computer, so What's new still reads offline and stays until the next installed version replaces it. wavebit never restarts by itself.

## Logo

- **The mark is Lucide's `AudioWaveform`**: a waveform drawn as one stroke, which is what the name says (a wave, made of bits). _Why: it is a line icon like every other icon in the app, so the logo and the UI share one stroke._
- **The desktop icon is the one exception to the next rule:** the white wave on a `#2f5bea` tile with 22% corners, because a bare line disappears on wallpapers and docks. Below 48px the stroke is heavier, and on macOS the tile is inset to Apple's icon grid. `npm run icons` renders them all. _Why: the owner chose it for every platform; the logo inside the app stays the bare line._
- **Stroke only.** No background tile, no fill, no gradient, no shadow. The stroke is the brand blue: `#2f5bea` in light, `#7f95ff` in dark. It does not follow the accent tone, so the brand stays recognisable.
- **The wordmark** is "wavebit" in Inter 600, lower case, in `ink`, with -0.02em tracking. The mark sits left of it with a gap of 0.4× the mark size.
- **Sizes:** 22px in the title bar, 28px in the sidebar header, 56px on the welcome screen, 72px in Settings › About.
- **App icon:** the same mark at stroke 2.25 on a 512px transparent canvas, rendered to `assets/brand/icon.png` and `icon.ico` by `scripts/build-icons.mjs`. The source SVGs are `assets/brand/logo-mark.svg` and `logo.svg`.

## Welcome and setup

The first run is four screens: Welcome, then three setup steps (Add your music, Connect Spotify, Make it yours). It never blocks the app: Skip setup on Welcome, and Skip for now on any step, go straight to Library, and every choice can be changed later in Settings. Setup shows once per installation; quitting part way resumes at the same step.

### Welcome

- **Expanded (840px and up):** title bar (logo and window controls only), then a split on `surface`. The left 56% holds the logo mark at 240px in the brand blue, stroke only, centred. The right 44% holds the column (at least 360px, content at most 400px), centred. There is no line, card or colour edge between the halves.
- **Column:** "Welcome to wavebit" (40px, 600, -0.02em), one sentence ("Your music files and your Spotify library, in one quiet player."), the primary pill "Get started" with an arrow, and a quiet "Skip setup" text button beside it. Under them in `muted`: "Takes about a minute. You can change everything later in Settings."
- **Narrower:** the mark shrinks to 120px at the top of one column, and the buttons go full width.
- **Motion:** the mark fades in once over 400ms. Nothing else moves.

### Setup steps

- **The same split as Welcome.** The left pane holds the step list: the 28px logo mark, then the three steps as rows with a 28px circular marker (the number in `muted` on `sunken`, `on-accent` on `accent` for the current step, a check on `accent-soft` once done), the step name and a one-line hint in `muted`. Steps are separated by 24px of space, never by a connecting line. A done step can be clicked to go back to it.
- **The right pane** holds the step's own content in a column at most 440px wide: the step count ("Step 1 of 3", `muted`, 13px), the title (32px, 600), one sentence, the content, then the footer: Back as a quiet pill on the left, and the step's primary pill on the right (Continue, or the step's own verb), with Skip for now as a quiet text button beside it.
- **Narrower than 840px:** the step list becomes a row of three 6px-high segments at the top (`accent` for done and current, `sunken` for the rest), and the footer pins to the bottom above the safe-area and keyboard insets.

**Step 1, Add your music (the import screen).**

- Each chosen folder is a 56px row: a 40px `sunken` tile with a folder icon, the folder name, its path and file count in `muted` (tabular figures), and a Remove icon button. "Add a folder" is a secondary pill under the list. Choosing a folder opens the system folder picker; the filesystem root and the home folder itself are refused inline with the reason.
- Reading starts as soon as a folder is added. While it runs: "Reading 1,204 of 3,890 files" over a flat 4px `ProgressBar`, then "3,890 songs found" with a check in `success`.
- One switch row: "Watch these folders for new music" (on by default).
- Continue is available once at least one folder has been added, or straight away as Skip for now.

**Step 2, Connect Spotify.**

- What wavebit reads, as two lines with check icons (playlists and Liked Songs; your name and picture), and what it never does, as one `muted` line (post, follow, change playlists or see your password).
- The primary pill is "Connect Spotify". The states:

| State     | What the column shows                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle      | As above.                                                                                                                                                                     |
| Waiting   | The pill shows its spinner and stays pending. Under it: "Finish signing in in the Spotify window. It shows accounts.spotify.com in its title." with Cancel and the `Kbd` Esc. |
| Error     | An inline `Alert` under the pill: cancelled, the window was closed, timed out, the network is down, or Spotify changed its web player. The pill is the retry.                 |
| Connected | The avatar and name with "Connected" in `success`, and the primary pill becomes Continue.                                                                                     |

- **The sign-in window** is Spotify's own login page in a separate, isolated window, 480×720, titled with the host it shows ("accounts.spotify.com") so the person can see where they are typing.
- **"What wavebit can see"** opens a sheet that says, in plain words: your playlists, Liked Songs, your name and picture. wavebit never posts, follows, edits playlists or sees your password. The session stays in this computer's encrypted cookie store, and signing out deletes it. wavebit is not an official Spotify app and uses the web player's session, which Spotify can change at any time.
- **Weak storage.** On Linux with no keyring service the session can't be stored safely, so it lasts until wavebit quits, and the step and Settings › Account say so.
- **Spotify's brand:** the Spotify name appears as text. wavebit does not draw Spotify's logo.

**Step 3, Make it yours.**

- Theme as the first three preview cards from Settings (System, Light, Dark), Accent as the five swatches, and Text size as a segmented control. Each applies the moment it is chosen, so the setup screen itself changes.
- The primary pill is "Start listening", which opens Library (or Home when Spotify is connected).

## Home

Home follows BitChord's: a feed of horizontal shelves, one after another (`design/Shelf.tsx`).

- **Header:** the time-of-day greeting, "Your music, Spotify and YouTube Music" in `muted`. Compact windows add the search pill.
- **Connecting:** no banners. What is left to connect is in the title bar (Layout › Connect labels). With no music folder, YouTube Music's shelves still fill the page.
- **Order:**
  1. **Top Picks for You.** 3:4 cards with 12px corners, drawn after BitChord's TopPicksShelf (`design/PickArt.tsx`). The art is the same in light and dark and held still (Motion). Caption: a 13px line, the 17px title at 600 (two lines at most), a 13px line at 85% white, 16px in from the edges. The row shows whenever any card has something behind it, even with no files.
     - **Where they come from, in order.** _New from …_: the newest release of the listener's top Spotify artist (else _New on YouTube Music_, the first album on its New releases shelf). _Your Station_: the files (weighted by plays), else Spotify's top songs. _Jump back in_: the newest album, playlist or artist in Spotify's recent plays. _Just added_ or _New from …_ from the files. _Your top artist_ from Spotify, else _Featuring …_ from the files. YouTube Music's own mixes (My Supermix, Discover Mix, New Release Mix). _Discovery Station_ and _Rediscover_ from the files, at 10 songs or more.
     - **How fresh they are.** Neither service pushes anything to a client, so this is as live as they allow. Every play updates the file-based cards at once (`playsChanged`, from `native/src/library/home.rs`); Spotify's are asked again every 2 minutes while Home is open and when the window regains focus; YouTube Music's after 10 minutes. Top songs and artists are cached an hour, since Spotify's own charts move slowly and it rate-limits this token hard.
     - **Drawn cards** carry the logo mark top right and a scrim from clear at 35% of the height to 70% black at the foot; without it white text misses AA on these colours (with it, every caption is at least 4.5:1). _Your Station_ (personal, weighted by plays): nested arrows from orange to pink on a red and pink gradient, line above the title `#ffd2da`. _Discovery Station_ (never played): a violet arrow over a fan of indigo, blue and teal shards, `#cdbdff`. _Rediscover_ (last played over 60 days ago) is wavebit's own card: BitChord's teal gradient with the arrows turned to look back, `#b5fff3`.
     - **Pictures.** _New from …_: the cover whole at the top, its lower edge fading into a blurred copy of itself behind the caption. _Featuring …_: the picture full bleed on its own darkened foot. The line above the title is white at 75%.
     - **No picture:** a flat `sunken` card with the music icon and ordinary text colours. No gradient.
  2. **Recently Played.** Four songs per column.
  3. **YouTube Music's own feed** (`FEmusic_home`): the account's feed when signed in, YouTube's public one for the region when not. Each shelf carries "YouTube Music" above its title, with YouTube's strapline when it has one. Albums and playlists open as wavebit pages; songs, videos and artists open in YouTube Music until wavebit streams YouTube.
  4. **Recently Added, Your playlists (Spotify), On Repeat, Your artists, Albums you haven't played.**
- **Shelves.** A title (with a chevron when there's a page behind it) and an optional source line above it. The row snaps to columns sized per kind and container width (square 2.4 to 6, circle 3.3 to 8, four-row songs 1.12 to 3, picks 1.6 to 5); narrow windows show a peek of the next card. Whenever a row has more than fits, two bare chevrons (Page actions, 26px in a 36px square) sit at the right of its heading and page it by one screen, always visible; each dims at its end. Rows bleed to the workspace edge (`--page-x`).

## Explore

After BitChord's ExploreScreen and YouTube Music's own Explore tab (`features/explore/`, `main/youtube/service.ts`). Reached from the icon after the search box, the sidebar, the tab bar or Ctrl 3. It works signed out: the account's feed when signed in to YouTube, the region's when not.

- **Header:** "Explore" and "Live from YouTube Music · Updated 14:02" in `muted`. There is no refresh button: the page keeps itself current.
- **Order:** the feed's first shelf (New albums & singles), Moods & moments as cards, the rest of the feed and charts as shelves (Trending, New music videos, Top songs…), then Genres as cards. A shelf with nothing in it isn't drawn; Spotify offers this token no browse feed, so Explore is YouTube Music's.
- **Mood cards (BitChord's).** 1.72:1 with 18px corners, as many 220px columns as fit (two at least) with 12px between. YouTube's colour for the category as the whole card, the first cover in that category grayscaled and multiplied over the right 72%, and the title in bold white at the top left, with no shading over the card. A pale YouTube colour is darkened only as far as white needs for 4.5:1 (`lib/moodTone.ts`); multiplying can only darken, so the title stays readable over the cover. A card with no colour gets one of BitChord's eight, from its title.
- **A category** opens as its own page: a link back to Explore, the title, then that mood's or genre's shelves.
- **How fresh it is.** YouTube pushes nothing to a client. The feed is read again every 2 minutes while the page is open and the window is showing, and when the window comes back after that long. A category is kept 30 minutes.
- **To refresh now,** pull the page down (Layout › Pull to refresh).
- **What the page can ask for.** Only `params` that match a short pattern; the browse id is fixed in the main process, and a card that points anywhere else is dropped while parsing.

## Library

- **Header:** the title "Library", then in `muted` the count and total length ("1,284 songs · 3 days, 4 hours", tabular figures).
- **Listening cards** (the top of the overview, under the heading "Your Listening"): the same 3:4 cards as Home's Top Picks (`design/PickCards.tsx`, Home › Top Picks), four across from 700px of page, sideways rows below that. The block, heading included, is at most 1240px wide and centred. _Minutes listened_ is drawn art: wavebit's blue with the logo's waveform held still behind the figure, line above the title `#cbd8ff`; it opens nothing, since there is no Replay page. _Top song_ and _Top album_ are the cover whole fading into its blur, _Top artist_ the picture full bleed. Each opens what it names; a streamed artist or album goes to search, while an artist or album from a file opens the library's page, so names in files stay here. A category with no plays is left out, and nothing shows before the first full minute. Time is measured as BitChord does: wall-clock while sound plays, 8 seconds at most per tick; a play counts once, at half the song or 4 minutes, never under 30 seconds. It starts at zero, covers files and streams, and stays on this computer (`main/services/listening.ts`). _Why: the owner asked for BitChord's stats on Library, with total listening, and for the cards to sit centred._
- **Overview** (what the sidebar's Library opens), after BitChord's: plain links to Downloads, Songs, Albums, Artists and Playlists with their counts, two columns from 900px, no lines between. Under them, Downloaded whole: the albums and playlists saved whole, hidden when there are none. Then one row per collection with Show all, each labelled with where it lives above its title:
  - **Spotify:** Playlists (Liked Songs first; signed out, one tile that connects Spotify), Saved albums (open as a Spotify album page), Artists you follow (open in Spotify).
  - **YouTube Music** (signed in): Playlists, Albums, Artists.
  - **On this computer:** Recently added, Artists, Albums.
  - With no music folder the overview still shows; Add folder is in the header and the title bar.
  - Add folder is a secondary button with its icon and label, in the header at every window size. There is no Refresh icon: pull to refresh rescans, and so do F5, File › Rescan library and Settings › Rescan now.
- **Downloads** (Library › Downloads), after BitChord's Downloads folder: only the songs wavebit saved, newest first, read from the download records, so they stay after Clear finished and a restart. Title, count and length; Play, Shuffle and Open folder; then Songs, Artists and Albums as a segmented control with the filter pill. Rows are Library rows; the menu adds Delete file, which asks inline and moves the file to the Trash. With none yet, the empty state says how to download.
- **A collection** (Songs, Albums, Artists, Playlists) is the full list with the toolbar below.
- **Toolbar, one 40px row:** Songs, Albums and Artists as a segmented control (`ToggleButtonGroup`), the filter pill ("Filter songs", Ctrl F; it filters the open list only), then on the right: Sort (a `Dropdown` button showing the current order, "Title"), List and Grid as a two-icon segmented control and Add folder (secondary).
- **List:** columns #, Title (40px artwork with the artist under it), Album, Added, Time. The header is `muted` 13px text with no line under it; the sorted column shows a chevron in `ink`. Rows are 56px, separated by 4px of space, 6px corners. The hovered row is `sunken` and shows a More button (⋯) where the time was; the playing row has its title in `accent` and the logo's waveform in place of the number. No lines between rows.
- **Grid:** 160px album tiles (artwork, album, artist).
- **Rows virtualize**, so 20,000 songs scroll like 20.
- A double-click or Enter plays the row with the visible list as the queue. A click selects. A right-click or long press opens the song's context menu (see Context menus).
- **Compact:** Title and time only; a tap plays; a long press opens the same context menu.
- **States:** no folders shows the empty state with "Add a music folder"; reading shows "Reading · 1,204 of 3,890 files" with a `ProgressBar` above the list; no match shows the search empty state.

### Library states

- **No folders yet:** the empty state fills the workspace, centred: the folder drawing (a folder outline in `faint` with a music note in `accent`), "Add your music", "Choose the folders that hold your music files. wavebit reads them where they are.", and one primary button, "Add a music folder". The toolbar shows only the title; Add folder is hidden because the empty state already offers the action.
- **Loading with nothing cached:** the real header, then `Skeleton` rows in the exact shape of the list: a 40px tile, two text bars (60% and 35% wide), an album bar and a time bar, at the real 56px row height, so nothing moves when the songs arrive. With Motion on, HeroUI's shimmer; with Motion off, still `sunken` blocks. Cached songs never hide behind it.

### Album page

Opened from an album tile, an album name in a row, or Show album.

- **Header (280px):** the artwork backdrop (see Artwork backdrop) behind the 220px cover (6px corners), then "Album" in `muted`, the album title (36px, 600), the artist as a link, and "2026 · 11 songs · 44 min" in `muted` tabular figures. Under them: Play (primary), Shuffle (secondary) and More (⋯).
- **Songs:** the Library rows without artwork or the Album column, numbered by track; a second disc gets a "Disc 2" heading. The playing row works as in Library.
- **Footer:** "Released 3 November 2026" and the file format in `muted`, then "More by The Low Tides" as a row of 160px album tiles.

### Artist page

Opened from an Artists tile or an artist link.

- **Header (280px):** the artwork backdrop of the artist's newest album, a 160px circle with the artist's initials on `accent-soft` (local files carry no artist photo; the circle marks a person), "Artist" in `muted`, the name (40px), and "4 albums · 38 songs". Play and Shuffle play every song by the artist.
- **Top songs:** the five most played, as Library rows in two columns on wide windows.
- **Albums:** 160px tiles, newest first. **Appears on:** albums where the artist is credited on some songs.

### Artwork backdrop

- The album or playlist cover, oversized, blurred (64px) and saturated (150%) into a soft wash of its colours, fading in over 500ms the first time it is drawn.
- **Page headers** fade away into the page: `surface` at 45% at the top, 72% at 18% of the height and solid at the foot, so there is no edge where the songs start. Text starts below that 18%. `muted` is a stronger mix there (86% `ink`), which keeps AA over the worst case, pure black or pure white artwork (6.0:1 light, 4.9:1 dark).
- **The full-screen player** can have text anywhere, so its scrim is even: `surface` at 90% in light and 88% in dark.
- **Album art cache.** Spotify and YouTube covers behind a page load once and are kept on disk (`main/services/artCache.ts`, `media://remote/…`): 256 MB at most, least recently used dropped first, up to 8 MB per image, only the same CDN hosts the CSP allows, and only real JPEG, PNG, GIF or WebP files. Covers from your own files are already stored in the library.
- Settings › Appearance › Show artwork behind pages turns it off, and the header is plain `surface`.
- Files without artwork get no backdrop.

## Spotify

- **Signed out:** the empty state, centred in the workspace: the playlist drawing (three list lines in `faint` with a note in `accent`), "Connect Spotify to see your playlists", "Your playlists and Liked Songs show here, and songs you already have as files play from them.", and one primary button, "Connect Spotify". The sidebar shows no Playlists heading while signed out.
- **Playlists:** Library › Playlists, a grid of 160px covers with name, owner and song count, Liked Songs first. Liked Songs isn't a playlist to Spotify and has no cover, so wavebit draws its own: a filled heart in `accent` on `accent-soft` (`design/PlaylistCover.tsx`), in the grid, the sidebar and the playlist header.
- **A playlist:** a header (the 200px cover; "Spotify playlist" in `muted`; the name at 36px; the owner, the song count and how many play from your files; then Play (primary, plays the matched songs), Shuffle (secondary) and Open in Spotify (quiet, opens the system browser)).
- **Under the header:** the filter pill ("Filter this playlist"). There is no "In your library" filter or column: every row plays.
- **Rows:** as in Library: #, Title (artwork, artist), Album, Added (only when some row has a date; Spotify's own playlists have none), a heart, Time, with the header in `muted` 13px text and no line under it. Each artist name opens that artist and the Album column opens that album, inside wavebit; the row's menu adds Song details. _Why: a Spotify row should lead to Spotify's page for it, whether or not a file matches._ A row plays from the matching file, else from its YouTube Music match (Player › Streams); nothing is dimmed or skipped. Compact windows drop the Album column.
- **Matching.** Each Spotify song is matched to a local file by normalised title, version words (remix, live, acoustic…) that must agree, an overlapping artist, and a duration within 3 seconds for a strong match (30 seconds at most).
- **Errors:** an inline `Alert` with Try again. "Spotify changed its web player" means the persisted query hashes moved; wavebit rereads them once by itself before showing it.
- **The heart.** Every Spotify row has one, 32px, filled `accent` when the song is in Liked Songs and an outline in `muted` when not. One call fills the hearts for up to 40 rows at a time (GET /me/library/contains, else the web player's `areEntitiesInLibrary`); a press changes the heart at once and saves or removes the song (PUT or DELETE /me/library, else `addToLibrary` / `removeFromLibrary`), and the heart goes back if Spotify refuses.
- **Artists** open inside wavebit (the web player's `queryArtistOverview`): the photo in a circle, "Spotify artist", monthly listeners and followers, Popular songs that play, then Albums, Singles and EPs, Compilations, Appears on and Fans also like (the split Spotify's `include_groups` gives), with About last, as on BitChord. Each row holds what the web player's overview returns; the full discography queries aren't in its public bundle. Followed artists in Library open here.
- **An album** opens on the playlist page: "Spotify album", "single", "EP" or "compilation" over the name, each artist a link, then the year (GET /albums/{id}, else `getAlbum`). Rows are numbered with no artwork and no Album column, since they are all the album's. Below them, BitChord's footer (release date, label, copyright) and More by.
- **A song** (`spotifySong`; GET /tracks/{id}, else `getTrack`): a page of its own, reached from Song details or a pasted link. The cover, "Spotify song", the title, its artists and album as links, the year, length, Explicit and play count, then Play, Add to queue, the heart and Open in Spotify, and On the album under them.
- **Links.** A pasted `https://open.spotify.com/<playlist|album|artist|track>/<id>` address (with or without `?si=` or a locale) or `spotify:<kind>:<id>` URI becomes the one result in the search box, which opens that page in wavebit. Anything else is searched as words. `shared/spotifyLink.ts` reads them, so only an id of the right shape reaches a request. _Why: no other host or path can be smuggled in through a paste._
- **Importing a playlist.** Library › Playlists has Import from a link (a sheet with one field), and a playlist that isn't on your list has Add to your playlists. An import reads the playlist the normal way (GET /playlists/{id} and /items, else `fetchPlaylist`), not BitChord's embed page, and refuses one Spotify won't open. Only the name, owner, cover and count are kept, in settings; the songs are read from Spotify each time. An imported playlist has Remove from wavebit, and nothing ever changes on the Spotify account.
- **On Home,** with Spotify connected: Recently played (a card each, the album, playlist or artist it came from), Your top songs (the four-row song shelf) and Your top artists (circles), after Home's own Recently Played. The top rows use the shortest period Spotify has anything for and say which: "this month" (`short_term`), "of the last 6 months" (`medium_term`) or "of the past year" (`long_term`). GET /me/player/recently-played and GET /me/top/\* answer first; when Spotify refuses them, the web player's recently-played feed with `fetchEntitiesForRecentlyPlayed`, and `userTopContent`. Each row stands alone: one with nothing to show isn't drawn.
- **Recently Played on Home is wavebit's own list.** BitChord's comes from the account's history, but a song played in wavebit runs through a file or YouTube's player and never reaches Spotify, so wavebit records it: once per song, after half its length or 4 minutes, never under 30 seconds, counting only time when sound plays (BitChord's ListeningRecorder rule). The newest 100 stay on this computer in `history.json`, display details only, and any of them plays again. Spotify's own Recently played row is separate, and shows what was played in Spotify itself. When the Web API answers, Show older pages back with `before`.
- **Where the data comes from.** The public Web API first, with the web player's token; Spotify answers that token with 429 on most endpoints, so the web player's own persisted queries (BitChord's method) answer instead, and after a 429 wavebit stops asking the Web API until Retry-After has passed.

## YouTube Music

Added after BitChord's YouTube Music side (`main/youtube/`).

- **Signing in:** Google refuses sign-in inside apps ("This browser or app may not be secure"), so wavebit uses Google's desktop-app flow: its own page in the default browser, a loopback redirect to 127.0.0.1 and PKCE. It needs the person's own OAuth client (Desktop app type), pasted once in Settings › YouTube Music with the three steps to make one. The client and refresh token are encrypted with the keyring in the main process (`main/youtube/oauth.ts`); access is read-only. Signed in, Library shows Your playlists, Liked videos (they play) and Subscriptions from the YouTube Data API (`dataApi.ts`), each labelled "YouTube".
- **Requests:** YouTube Music's web client (`youtubei/v1`, WEB_REMIX). The music.youtube.com page's own config gives the client version, visitor id, whether the session is signed in and which Google account and channel to use. Signed in, each request carries `Authorization: SAPISIDHASH …` and `X-Goog-AuthUser`, made in the main process from a cookie that never leaves the partition.
- **Pages:** an album or playlist opens as the Spotify playlist page does: the cover over the backdrop, "YouTube Music album" or "playlist", the artist or owner, YouTube's own "14 songs • 46 minutes" line and how many play from your files; Play, Shuffle, Save to library (signed in; YouTube's like on the list, a bookmark icon filled when saved) and Open in YouTube Music. Rows match local files the way Spotify rows do; a matched row plays, the rest open in YouTube Music.
- **Artist pages** (browse UC…): the photo in a circle over the backdrop, "YouTube Music artist" with the mark, the name, subscribers and description, then the page's own shelves (Top songs, Singles & EPs, Videos, Featured on, Fans might also like). An album's artist line links to it.
- **Clicks stay in wavebit.** Albums, playlists and artists open as pages; a song or video plays, from a file when one matches, else in YouTube's embedded player.
- **Nothing opens the browser by itself:** songs and videos play in wavebit (Player › Streams).

## Player

- **One audio element** for the whole app. Local files stream from `media://track/<id>`.
- **Media keys** work through the Media Session API, and the OS shows title, artist and artwork.
- **Controls** are plain icons: Play is the `accent` circle icon (CirclePlay or CirclePause), the rest are `ink`. The seek bar is a wave: the played part is a 12px-tall `accent` sine line that ends in a round `accent` dot, and the part still to come is a flat 3px `line-strong` line. The wave flows while the song plays and settles to 18% of its height when paused. With motion reduced or off it holds still. Times are in `muted` tabular figures. _Why: it says "playing" at a glance, and the logo is a waveform too._
- **Keyboard:** Space plays or pauses (unless a text field has focus), Ctrl Left and Ctrl Right skip.

### Streams

Songs with no file play in YouTube's official embedded player (`youtube-nocookie.com/embed`), driven through its documented postMessage interface (`features/player/youtubeEmbed.ts`); no YouTube script runs in wavebit's page and no stream is extracted. Like BitChord's video, it shows only the picture: YouTube's controls, keyboard, fullscreen button, annotations and end screens are off through the embed's own parameters (`controls=0`, `disablekb`, `fs=0`, `iv_load_policy=3`, `rel=0`), and wavebit's controls do everything. BitChord's own video element plays streams it extracts itself, which wavebit does not do.

- **What streams:** a Spotify row with no matching file is found on YouTube Music when it comes up, as BitChord's SpotifyImporter does it (a Songs search for "title artist", the TrackMatcher's best, else the first hit; cached 30 days). YouTube rows, Home cards and artist-page songs stream their own video. Rows say "Plays from your files" or, with the YouTube Music mark, "Plays from YouTube Music".
- **The stage** (`YouTubeStage.tsx`, `videoStage.ts`), after BitChord's video surfaces: surfaces (the Now playing drawer, the full-screen player's video slot and its theater) take turns showing the video, the one mounted last in front. An iframe reloads when it is moved, so the stage is placed over the surface and follows its box frame by frame instead. There is no floating video: with no surface it plays off screen.
  - **Now playing drawer:** the video is the backdrop of the drawer's top section; see Now playing drawer below.
  - **Full-screen player:** a video opens on its own (theater), filling the player with a `surface` band under it holding the title, artist, transport, seek bar, volume, details, queue and collapse. The details button puts the video in the artwork's place at 16:9 beside the title column; a button there goes back to theater. Nothing is drawn over the video.
  - **Visible unless the listener hides it:** YouTube's terms for embedded players require the player to stay visible, at 200px or more, so a video starting opens the drawer (except on a phone width, where the drawer would take the whole window). Hide video in the drawer, or closing the drawer, is the listener's choice: the stage moves off screen and keeps playing, with no message. The drawer offers Show video in Hide video's place, and the full-screen player shows the artwork meanwhile. Hide video is remembered on this computer. The video disappears when a file plays.
- **Controls:** play, pause, seek, volume, next and previous drive the embed; the bar follows its time reports. Crossfade and normalisation apply to files only. A video YouTube won't embed shows the error state and the queue moves on after 1.5 seconds.
- **Identity:** embed requests carry the app's identity in the Referer header, as YouTube asks of embedding apps (`identifyToYouTubeEmbeds`).

### Queue

After BitChord's Up Next (`QueuePanel.tsx`), three tiers in this order:

- **What you started** (the album, playlist, shelf or search), headed "Next from …".
- **Added by you:** Play next puts a song at the head, Add to queue at the tail. A new list keeps these right after its first song.
- **AutoPlay:** when fewer than three songs are left (repeat off), YouTube Music's radio for the last song is added (`next` on RDAMVM<id>): at most 10, one per recording, no more than 2 per artist (4 for the seed's), the song preferred over its video. A Spotify song or a file is found on YouTube Music first. The ∞ button in the panel's header turns it off; the choice is remembered.

Rows: a press plays the song now (a hand-added one drops the hand-added songs it skips over); the context menu starts with Play now, Play next and Remove; × removes; the list part drags to reorder (Alt Up, Alt Down). Clear removes only the songs you added. Previous restarts the song after 10 seconds. Every song anywhere (library rows, Home cells, YouTube shelves and cards, search results) has ⋯ with Play next and Add to queue.

### Search

- **Typing** in the title-bar pill searches your files and the loaded playlist names at once, and YouTube Music once typing pauses for 300ms (two characters or more). Spotify is not called while typing. The dropdown shows at most 9 results: files and playlists first and up to 5 of them once YouTube Music has answered, YouTube Music after them, and either side takes the rows the other leaves (`features/search/budget.ts`). The last row, "See everything for …", isn't counted and opens the Search page.
- **The Search page:** your files (Songs, Albums, Artists), then YouTube Music's search grouped into Top result, Songs, Videos, Albums, Artists and Playlists (it now answers one row per section, so wavebit groups them), then Spotify's songs (the web player's `searchTracks`; the public `/search` refuses its token), 20 more with Show more. Everything plays. Each source is headed with its mark.

### Lyrics

Every song gets its words the same way, whether it's a file, a Spotify song or a YouTube one, because they're found by name (`shared/lyricsParse.ts`, `main/lyrics/`). Nothing is sent until lyrics are opened.

- **Finding them,** after BitChord's LrcLib and LyricsQuery. The title loses credits and upload labels ("(feat. X)", "[Official Video]") and keeps what names another recording ("(Remix)", "(Live)"). _Why: wrong words in time are worse than none._ The artist is the first credited one. LRCLIB's `get` is asked for that length; on a miss, `search` takes the hit closest in length, within 15 seconds so the words can't drift. Timed lyrics win over plain ones. An answer is kept 30 days; a miss 12 hours.
- **Nine sources, no keys** (`shared/lyricsSources.ts`): lrc.red, BiniLyrics, BetterLyrics, BetterLyrics Portato, LyricsPlus, Unison, YouTube Music, KuGou, LRCLIB, in that default order. Settings › Appearance › Lyrics sources switches each one and reorders them. All are asked together and read in that order: the first with timed lines wins, otherwise the first with anything. A song with no artist tag asks only LRCLIB, because the others guess from a bare title. A source that fails is skipped; "Couldn't reach" shows only when all of them fail. Each answer is kept per source, 30 days for a hit and 12 hours for a miss. BitChord's Musixmatch (a secret pulled from its website), Genius (scraping) and PaxSenix (needs a key) aren't used. Word timings are flattened to lines, because lyrics follow line by line.
- **Where they show:** the Lyrics button in the player bar opens a panel in the queue's column (360px; only one of the two is open), and in the full-screen player the button puts the words in a column of their own beside the artwork or video, title and controls. The two columns are one group centred in the window, the words capped at 38% of its width (BitChord's grid), and the lines are centred in their column. On a phone width they take the artwork's place.
- **Timed lines:** the current line is bold and sits 30% of the way down, the lines one and two away at 0.7 and 0.58 opacity, the rest at 0.46. Full-screen lines are 26, 30, 36 or 42px from widths of 980, 1320 and 1680px; the panel's are 20px. A click seeks to a line. Scrolling by hand stops the following for 4 seconds. A break of 4 seconds or more shows three dots that breathe while it lasts. _Why these numbers: they are BitChord's._
- **Untimed lyrics** are a still page headed "These lyrics aren't timed."
- **The states:** a spinner while looking; "No lyrics available"; "Instrumental"; "Couldn't reach any lyrics source" with Try again; "No lyrics sources are on". A small credit naming the source that answered sits under the words.
- **Synced lyrics off** shows the words as a still page. **Blur unfocused lyrics** blurs lines by their distance from the current one, never while a hand is on the scroller or with Reduce blur on.
- **Behind them:** the artwork backdrop, or Canvas when it is on. No colour gradient: DESIGN.md's rule stays.

### Context menus

Nothing has a three-dot button. A right-click, a long press, the Menu key or Shift F10 opens one menu at the pointer (BitChord's long-press menus, as a desktop menu). HeroUI has no context menu, so it is a `Dropdown` with an invisible trigger placed where the pointer was; one host serves the app, and the rows of each menu come from `features/menus/menus.ts`. Each row has a 16px `muted` Lucide icon and a label. Groups are set apart by 8px of space, never a line. Destructive rows are `danger`.

- **Song:** Play, Play next, Add to queue, Start radio (a YouTube song) · Go to album, Go to artist · Save to or Remove from Liked Songs (Spotify rows that report it) · Show details, Show in folder (a file), Open in YouTube Music or Open in Spotify, Copy link.
- **Album, playlist:** Play, Shuffle, Play next, Add to queue (read when chosen, at most 500 songs) · Open album or Open playlist, Go to artist (a library album) · Show details, Open in Spotify or YouTube Music, Copy link · Remove from wavebit (a playlist added from a link).
- **Artist:** the same, with Open artist. A YouTube Music artist has no song list to play, so it starts at Open artist.
- **Queue row:** Play now, Play next, Remove from queue, then the song's other groups. **Now playing** (player bar, mini player, full-screen cover) is a song menu.
- **Library folder:** Open folder, Rescan library, Copy path · Remove from library.
- **Top Picks:** a release, artist or mix card has that kind's menu; a station has Play.
- **Show details** opens the queue's sheet (side drawer, or bottom sheet when compact): the picture, the title, then label and value rows. A file adds track, disc, date added, plays, format, size and modified date. A Spotify song opens its own page instead.
- **What crosses IPC:** Show in folder sends a song id, and the main process finds the file; Open folder works only for a folder the library already reads; the page has no clipboard permission, so Copy goes through the main process. File paths for songs never reach the page.
- **Download** (a streamed song with no file) and **Download all** (a streamed album or playlist, at most 200 songs). Playback stays on YouTube's embedded player; saving is separate (see Downloads below).

### Downloads

Songs are saved by the yt-dlp and Deno that ship inside wavebit (`tools/`, pinned in `scripts/tools.lock.json`), so there is nothing to install or set up. Audio only, as AAC in `.m4a`, tagged with the title, artist, album and cover, into `Music/wavebit` unless the user chooses another folder. That folder joins the library, so a song's row plays from its file once the scan has run. Library › Downloads lists them on their own.

- **The title bar** has a download button beside Explore that opens the drawer. While anything is active its wavy ring shows the whole batch; when it's over, a green tick, or a warning if a song failed.
- **The drawer** (side or bottom sheet): each song's cover, title, artist, source, real file name and status. A right-click offers Download next and Cancel; Retry and Remove; or Play, Show in folder, Go to album, Remove from list and Delete file (to the Trash, after asking). Above the list, four large bare icons that stay in place and dim when they can't be used: Pause or Resume, Cancel all, Retry failed, Clear finished. The list fills the drawer's height, with no scrollbar beside it.
- **A song's cover** stays square, turns into a circle in the wavy ring while it waits or downloads, and returns to square when it's done. Where a row has no cover, the number column shows a small ring. A failed song has a warning on its cover.
- **The green tick** sits beside the title of every song on this device, your own files included, in every list and the player.
- **Albums and playlists** have a large download button just before the Open in Spotify or YouTube Music link. Its ring counts only that list; a tick means every song is here.
- **Settings › Downloads:** folder, Artist and Album folders, songs at a time (1 to 4), skip what you own, embed cover and lyrics, keep downloaded playlists up to date, and download the whole library (it says how long first).
- **Duplicates** are stopped four ways: the same song already queued; its video already saved with the file still there; the same recording already in the library; and, once a Spotify song has its video, the first two again.
- **Pacing:** at most 250 songs start in an hour, under the roughly 300 yt-dlp's wiki gives for anonymous use. Past that the queue waits and says when it continues. When YouTube limits requests, the queue stops and offers Resume.
- The queue is saved, so it carries on after a restart.
- No account is used, so age-restricted, private and Premium-only songs fail with a reason. Spotify songs are matched to YouTube Music; Spotify's own audio is never touched.
- **What crosses IPC:** a video id or what to search for, with display details, and job ids for every action. Never an address, a path or a program. The page sees file names, not full paths. The folder is set only through the system picker.

### System tray

wavebit keeps an icon in the system tray (`main/window/tray.ts`, the menu in `trayMenu.ts`). BitChord has no desktop app, so this follows Electron's documented rules.

**Linux:** a tray exists only if the desktop provides one (`org.kde.StatusNotifierWatcher`: COSMIC and KDE do; plain GNOME needs an extension, and an app run inside a Flatpak can't reach it). wavebit asks first. With no tray it keeps none, and closing the window quits; Settings › Playback says so. Below 800px of usable height the panels and pages fold into an Open row, because COSMIC's tray popup can't scroll.

- **The menu, top to bottom:** the song and artist (or "Nothing playing"); Play or Pause, Previous, Next; Shuffle and a Repeat submenu; Now playing, Lyrics, Queue; Home, Library, Search, Settings; Show or Hide wavebit and Keep running when closed; Quit wavebit. The tooltip is the song and artist. Player items are off when nothing is loaded.
- **The icon:** a click shows or hides the window on Windows. On Linux the desktop decides what a click does, so everything lives in the menu, which is rebuilt on every change because Linux needs that.
- **Closing the window** leaves wavebit playing in the tray, with Settings › Playback or the tray's own checkbox to turn that off. Quit really quits. Launching wavebit again brings the window back, which is the way home on a desktop with no tray. A closed window hides a playing video, so YouTube's terms and possible pausing apply as for Hide video.

### Full-screen player

Opened from the player bar's expand button, a click on its artwork, or a tap on the mini player. Esc, the Collapse button or Back closes it.

- **Expanded and medium:** it covers the workspace and the sidebar; the title bar stays (its menus still work). The whole area is the artwork backdrop. Left: the cover at up to 480px (6px corners). Right, in a column at most 440px: "Playing from Coastline" in `muted` (a link to the source), the title (32px, 600), the artist and album as links, the seek bar (6px track, times under it), then the transport: shuffle, previous, Play (64px CirclePause in `accent`), next, repeat. Under it a row of quiet icon buttons: Queue, volume with its slider, and Collapse.
- **Compact:** one column: a Collapse chevron and "Playing from Coastline" in a 56px top bar, the cover at the full width less 24px each side, the title (24px) and artist, the seek bar, the transport (Play at 72px), then Queue and volume. It pads for the safe areas.
- **Motion:** it slides up over 300ms and the cover scales from the player bar's artwork. Reduced: a 150ms fade. Off: instant.

### Now playing drawer

`NowPlayingPanel.tsx`, in the same 360px column as the queue and lyrics (one at a time). The player bar's drawer button (`accent` while open) and the mini player open it, and a video starting opens it by itself except on a phone width.

- **One scrolling column, top to bottom:** the top section (400px), Lyrics, About the artist, Next in queue. A section with nothing to show is left out.
- **The top section:** the video, or else the Canvas or cover, edge to edge from the very top of the column and fading away into `canvas` (solid to 42%, gone by 85%). A wide video is cropped to fill it. The source name, Expand and Close sit on a dark fade at the top; the title and artist sit on the faded part, with Hide or Show video for a stream and the heart for a Spotify song. _The fade and the top icons do cover YouTube's player, which its rules for embedded players don't allow; this is a deliberate choice for this view only._
- **Lyrics:** the current line and the next one over a blurred wash of the cover, 60% black over it so white text holds AA. Fetched only while the drawer is open.
- **About the artist:** the picture, name, listeners or subscribers and three lines of biography. Spotify's artist for a Spotify song, otherwise YouTube Music's by the first credited name.
- **Next in queue:** the next three songs; a press plays one now.
- **Expand icons:** the top section opens the full-screen player, Lyrics the full-screen lyrics, About the artist's page (the library's for a file), Next in queue the Up next view. Up next and Lyrics have a Back button and keep a playing video at the top of the column.
- **Compact:** the drawer fills the window and the tab bar and mini player step aside.

### Queue

- **Desktop:** a 360px panel docked at the right of the workspace, on `canvas`, above the player bar; the workspace narrows to make room, and nothing is covered. The tone change is the edge; no line.
- **Contents:** "Up next" (20px, 600) with Clear and a Close icon button; "Now playing" with the playing song (its title in `accent`); then "Next from Coastline" and the queued songs as 52px rows: 40px artwork, title, artist, and on hover a drag handle on the left and Remove on the right. Rows reorder by dragging the handle (a 2px `accent` line marks where it lands), or with Alt Up and Alt Down. Songs added with Play next sit in their own "Added by you" group above the source.
- **Compact:** the same list in a bottom `Sheet`.
- The Queue button in the player bar is `accent` while the panel is open.

### Search

- **The title-bar pill** docks its results under it in a `raised` panel exactly as wide as the pill (6px corners, the overlay shadow, no border), at most 340px tall and scrolling inside, as 56px rows with 40px pictures: "Your songs", "Your albums" and "Your artists" from the files, Spotify playlists from the loaded list, then YouTube Music's real results (Top result 1, Songs 3, Artists and Albums 2, Playlists 1), 9 results at most, and "See everything" last. Artists are circles, everything else square covers. A song or video plays, the rest open their pages. A small "Searching YouTube Music" line shows while it waits. Up and Down move, Enter opens, Esc clears.
- **No results:** the panel shows the search drawing (a magnifier in `faint` with a small `accent` question mark), "No matches for "kraftwerk"", "Check the spelling, or try an artist or album name.", and one quiet button, "Clear search".

## Settings

- **Search:** every setting is listed once in `features/settings/settingsIndex.ts`, which also supplies its name and hint on the page, so the two can't drift. Results need every word of the query and rank names first. Arrow keys and Enter work; choosing one opens the section, scrolls to the setting and tints it `accent-soft` for 1.6 seconds. The first Escape clears the search, the next leaves Settings.
- **Groups,** after BitChord: a small uppercase `muted` heading, then the group's rows in one card (10px corners, `ink` at 5% over `surface` in every theme), with an optional note under it. A row's hover fills the card edge to edge. Rows are separated by space and their own hover, never a line (Principles › No dividers).
- **Navigation:** the sidebar's contents swap to the Settings sections (see Layout › Settings replaces the sidebar). The page shows one section at a time: its title (26px), one `muted` line, and its groups, in a column at most 720px wide **centred in the workspace**, so the content sits in the middle of the window however wide it is. **Compact:** a Settings list page; each section opens as its own page with a back row.
- **Appearance:**
  - Theme as six selectable cards (System, Light, Dark, Pure Black, Midnight, Artwork; a 124px miniature of the app in that theme and the chosen accent, then the name and a radio mark that becomes a check; the selected card has a 2px `accent` outline). Setup shows only the first three. _Why cards here: each is a radio option with a picture, and the picture is the point._
  - **Themes** from BitChord's TV app, built on Dark with their own surfaces (`data-palette`): Pure Black (true black, for OLED screens), Midnight (deep navy), Artwork (every surface takes the hue of the playing cover's most colourful colour, enriched so a muted cover still shows clearly; a truly grey cover stays neutral. `lib/artPalette.ts` sets each surface's lightness so text holds AA on any cover, and the theme's `muted` is a little stronger than Dark's).
  - Accent as five 32px swatches.
  - Text size (Small 14, Default 15, Large 16, Larger 17) as a segmented control.
  - Song rows (List 56px, Compact 44px) as a segmented control, also in the view menu on song pages.
  - Font (Inter, System) as a segmented control.
  - Motion (Full, Reduced, Off) as a segmented control.
  - Switch rows: More contrast; Show artwork behind pages (on by default; see Artwork backdrop); Reduce blur (the artwork backdrop, the Now playing lyrics card and Top Picks' fades give way to solid fills).
  - **Player:** Player theme (Blur, or a still Mesh in the cover's hues, made rich and then limited in brightness so text holds AA and accent controls 3:1 with no scrim, using the stronger secondary text of the artwork backdrop; it never moves); Spotify Canvas (switch, off by default; plays Spotify's looping clip behind the full-screen player for songs started from a Spotify playlist, muted and paused with the music; disabled, with the reason, while Motion is below Full or signed out); Hide volume bar; Hide "Playing from"; Show queue history (up to 25 songs above Now playing).
  - **Lyrics:** Synced lyrics, Blur unfocused lyrics, Lyrics sources (a sheet; see Lyrics).
- **Spotify** (it replaces the old Account section):
  - **Account:** the avatar and "Signed in as <name>", or "Not connected" with Connect Spotify; how the session is stored ("Encrypted with your system keyring" or "Kept until wavebit quits, because this desktop has no keyring"); Sign out (`danger-soft`).
  - **Library:** Show playlists in the sidebar (switch); Refresh playlists (secondary button; playlists are cached 10 minutes to spare Spotify's rate limits); one `muted` sentence on how matching works.
- **Library:** the music folders as in setup step 1, each with Remove, then Add folder and Rescan, and the "Watch these folders" switch.
- **Content preferences** (BitChord's six): **Prefer music-only version** plays a music video as its catalogue song when YouTube Music has one with the same title, version and artist, and otherwise plays the video. **Square video thumbnails** (shelves only: a playing video keeps its shape). **Hide Recently Played**, **Hide videos from Home** (a shelf of only videos goes too), **Hide Top Picks for You**, **Hide Find Your Mood** (the moods and genres on Explore).
- **Playback:**
  - **Crossfade:** Off, 3, 6, 9 or 12 seconds (segmented, BitChord's lengths). Within that length of the end, the next song starts on a second player at volume 0; the moment its audio flows, the two fade equal-power, with a trim of 1/√(in + out) so the overlap never sums past full scale. A skip, seek or pause ends a blend at once. If the next song can't start in time, the current one plays to its end.
  - **Volume normalisation** (switch, on by default) and **Volume level**: Quiet, Normal, Loud (−23, −14, −11 LUFS, Spotify's levels). Each song is levelled to the target by its own integrated loudness (EBU R128): from a ReplayGain tag when the file has one, otherwise measured once in Rust the first time the song is about to play and stored in the library. Cuts are taken in full; a boost stops where the song's peak would reach full scale, so nothing clips. During a crossfade each side keeps its own song's level.
  - **Sound** (files only): **Equalizer**, a sheet with 16 presets, seven bands (60 Hz to 14 kHz, ±12 dB, shelves at the ends) and left and right balance. A preamp takes back the largest boost so it can't clip. **Spatial audio** (switch) widens stereo by raising what differs between the channels.
  - **Speed and timing:** **Playback speed** (0.5× to 2×, pitch kept; also YouTube's player). **Skip silence** (switch, files only): a gap past 1 second plays at 4× until sound returns. **Sleep timer**: 15, 30, 45 or 60 minutes or the end of this song; it lasts until wavebit quits. One `muted` sentence says these effects can't reach YouTube's embedded player.
  - **Remember the queue between launches** (switch).
  - **AutoPlay** (switch; the same setting as the queue's button) and **Don't repeat songs** (switch, off while AutoPlay is off).
- **About:** the 72px logo, the version, and the runtime versions (wavebit, the Rust native module and the platform; not Electron, Chromium or Node.js) as a two-column list (no table lines).
- **Switch rows:** the whole row toggles, with the switch on the right. A switch that cannot work here is disabled and its description says why.

## Motion

The `motion` setting has three levels: Full, Reduced and Off. The OS reduced-motion setting caps Full at Reduced. Off sets `data-reduce-motion="true"` on `<html>`, which turns off HeroUI's own animations.

- **The logo fades in once** on the welcome screen.
- **Sheets slide** in 250ms and fade the scrim. Off makes them appear instantly.
- Nothing loops except a spinner while work is pending, and the wavy ring of a song downloading right now. Reduced and Off stop the wave; its progress still moves.

## Empty states

Every empty state has exactly:

1. A line drawing in `faint` with **one** element in `accent` (`design/EmptyArt.tsx`: folder, search, playlist, offline).
2. A title.
3. One sentence that says what will appear here or why it is empty.
4. One action, the most likely next step.

When a page is empty, its toolbar drops any button that repeats that action.

## Loading

- **Waits with nothing cached** show a `Skeleton` in the shape of what is coming (rows, tiles, the playlist header). Cached content never hides behind it.
- **App start** shows nothing until settings are read (one IPC call), so the theme never flashes.
- **Scanning** shows a determinate `ProgressBar` that moves only as files are read.

## Spinners

A button that starts async work shows a spinner while the work is pending.

- **A button that can be pending has an icon**, and the 16px spinner takes the icon's place, so the label stays and the button keeps its width (`design/PendingButton.tsx`).
- The button stays focusable while pending and ignores further presses. It sets `isPending`, which reports busy to assistive tech.

## Toasts

Short results of actions whose own UI has already closed: connected, signed out, a folder added.

- **Flat.** `raised` fill, 6px corner, the soft overlay shadow, no border. One at a time.
- **Icon plus text.** Success and danger colour the icon only.
- **Never a decision.** Anything that needs an answer stays inline or in a sheet. Errors stay 8 seconds, everything else 4.

## Focus

Focus is a 2px solid `accent` outline at a 2px offset on every focusable element, shown for keyboard focus only (`:focus-visible`). Text fields keep their outline colour when focused and show the caret.

## Android (later)

Not built yet. When it is, it keeps everything above and adds:

- **Edge to edge** with `WindowInsets.safeDrawing`; the tab bar pads itself with the navigation-bar inset.
- **The keyboard:** `adjustResize` and IME insets, so sheets and the search field rise above it.
- **Predictive back:** Back closes a sheet, then clears a search, then steps back a page.
- **Spotify:** the cookie sign-in used on desktop needs an embedded browser, which a phone build should not ship. Android shows Spotify as "Available on desktop" until a sign-in method is decided.
- **Storage:** anything secret is encrypted with an Android Keystore key and excluded in both `backup_rules.xml` and `data_extraction_rules.xml`.
