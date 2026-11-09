import type { TrayCommand, TrayState } from '../../shared/schemas/tray.ts';

/** A command for the renderer, or something the main process does itself. */
export type TrayAction = TrayCommand | 'show' | 'hide' | 'quit';

export interface TrayItem {
  label?: string;
  type?: 'separator' | 'checkbox' | 'radio';
  action?: TrayAction;
  enabled?: boolean;
  checked?: boolean;
  submenu?: TrayItem[];
}

const MAX_LABEL = 60;

/** Room for a menu row; `&` would otherwise underline the next letter outside macOS. */
export function menuText(text: string, mac: boolean): string {
  const short =
    text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
  return mac ? short : short.replace(/&/g, '&&');
}

export function trayTooltip(state: TrayState): string {
  if (!state.title) return 'wavebit';
  const line = state.artist ? `${state.title} – ${state.artist}` : state.title;
  // Windows refuses a tooltip of 128 characters or more.
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** `gdbus call … NameHasOwner` says `(false,)` when nothing on the desktop draws a tray. */
export function trayHostAnswer(stdout: string): boolean {
  return !/\(\s*false\s*,?\s*\)/.test(stdout);
}

/** Below this much usable height the full menu may not fit. */
export const SHORT_SCREEN_PX = 800;

/** DESIGN.md › System tray, top to bottom. Pure, so it can be tested without Electron. */
export function trayItems(
  state: TrayState,
  window: {
    visible: boolean;
    closeToTray: boolean;
    mac: boolean;
    /** The pages fold into one row: some Linux tray menus can't scroll. */
    short?: boolean;
  },
): TrayItem[] {
  const hasTrack = state.title !== null;
  const line: TrayItem = { type: 'separator' };
  const panels: TrayItem[] = [
    { label: 'Now playing', action: 'nowPlaying', enabled: hasTrack },
    { label: 'Lyrics', action: 'lyrics', enabled: hasTrack },
    { label: 'Queue', action: 'queue', enabled: hasTrack },
  ];
  const pages: TrayItem[] = [
    { label: 'Home', action: 'home' },
    { label: 'Library', action: 'library' },
    { label: 'Search', action: 'search' },
    { label: 'Settings', action: 'settings' },
  ];
  return [
    ...(hasTrack
      ? [
          { label: menuText(state.title!, window.mac), enabled: false },
          ...(state.artist
            ? [{ label: menuText(state.artist, window.mac), enabled: false }]
            : []),
        ]
      : [{ label: 'Nothing playing', enabled: false }]),
    line,
    {
      label: state.playing ? 'Pause' : 'Play',
      action: 'toggle',
      enabled: hasTrack,
    },
    { label: 'Previous', action: 'previous', enabled: hasTrack },
    { label: 'Next', action: 'next', enabled: hasTrack },
    line,
    {
      label: 'Shuffle',
      type: 'checkbox',
      checked: state.shuffle,
      action: 'shuffle',
    },
    {
      label: 'Repeat',
      submenu: (
        [
          ['Off', 'off'],
          ['All', 'all'],
          ['One', 'one'],
        ] as const
      ).map(([label, value]) => ({
        label,
        type: 'radio' as const,
        checked: state.repeat === value,
        action: `repeat:${value}` as const,
      })),
    },
    line,
    ...(window.short
      ? [{ label: 'Open', submenu: [...panels, line, ...pages] }]
      : [...panels, line, ...pages]),
    line,
    window.visible
      ? { label: 'Hide wavebit', action: 'hide' }
      : { label: 'Show wavebit', action: 'show' },
    {
      label: 'Keep running when closed',
      type: 'checkbox',
      checked: window.closeToTray,
      action: 'closeToTray',
    },
    line,
    { label: 'Quit wavebit', action: 'quit' },
  ];
}
