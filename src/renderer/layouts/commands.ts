import type { QueryClient } from '@tanstack/react-query';
import { nav } from '../app/router';
import { currentUi, filterInputId, searchInputId, setUi } from '../app/ui';
import { THEME_NAMES, ThemeSchema } from '../../shared/schemas/settings';
import { player } from '../features/player/player';
import { keys } from '../lib/queries';
import type { Settings } from '../../shared/schemas/settings';

export interface Command {
  id: string;
  label: string;
  keys?: string;
  checked?: boolean;
  run: () => void;
}

export interface CommandContext {
  client: QueryClient;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  showShortcuts: () => void;
  /** A downloaded update is waiting for a restart. */
  updateReady: boolean;
}

const focus = (id: string) => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.focus();
  el?.select();
};

const addFolder = (client: QueryClient) =>
  void window.wavebit.library
    .addFolder()
    .then(() => client.invalidateQueries({ queryKey: keys.library }));

/** DESIGN.md › Menus. Each group is separated by space, never a line. */
export function menus(
  ctx: CommandContext,
): { name: string; groups: Command[][] }[] {
  const { client, settings, update } = ctx;
  return [
    {
      name: 'File',
      groups: [
        [
          {
            id: 'add',
            label: 'Add music folder',
            keys: 'Ctrl O',
            run: () => addFolder(client),
          },
          {
            id: 'rescan',
            label: 'Rescan library',
            keys: 'F5',
            run: () => void window.wavebit.library.scan(),
          },
        ],
        [
          {
            id: 'quit',
            label: 'Quit',
            keys: 'Ctrl Q',
            run: () => void window.wavebit.app.quit(),
          },
        ],
      ],
    },
    {
      name: 'Edit',
      groups: [
        [
          {
            id: 'find',
            label: 'Find in this list',
            keys: 'Ctrl F',
            run: () => focus(filterInputId),
          },
          {
            id: 'search',
            label: 'Search your music',
            keys: 'Ctrl K',
            run: () => focus(searchInputId),
          },
        ],
      ],
    },
    {
      name: 'View',
      groups: [
        [
          {
            id: 'home',
            label: 'Home',
            keys: 'Ctrl 1',
            run: () => nav.go({ name: 'home' }),
          },
          {
            id: 'library',
            label: 'Library',
            keys: 'Ctrl 2',
            run: () => nav.go({ name: 'library', tab: 'overview' }),
          },
          {
            id: 'explore',
            label: 'Explore',
            keys: 'Ctrl 3',
            run: () => nav.go({ name: 'explore' }),
          },
          {
            id: 'settings',
            label: 'Settings',
            keys: 'Ctrl ,',
            run: () => nav.go({ name: 'settings', section: 'appearance' }),
          },
          {
            id: 'fold',
            label: settings.sidebarCollapsed
              ? 'Unfold sidebar'
              : 'Fold sidebar',
            keys: 'Ctrl B',
            run: () => update({ sidebarCollapsed: !settings.sidebarCollapsed }),
          },
        ],
        ThemeSchema.options.map((theme) => ({
          id: `theme-${theme}`,
          label: `${THEME_NAMES[theme]} theme`,
          checked: settings.theme === theme,
          run: () => update({ theme }),
        })),
      ],
    },
    {
      name: 'Playback',
      groups: [
        [
          {
            id: 'toggle',
            label: 'Play or pause',
            keys: 'Space',
            run: () => player.toggle(),
          },
          {
            id: 'next',
            label: 'Next',
            keys: 'Ctrl →',
            run: () => player.next(),
          },
          {
            id: 'previous',
            label: 'Previous',
            keys: 'Ctrl ←',
            run: () => player.previous(),
          },
        ],
        [
          {
            id: 'shuffle',
            label: 'Shuffle',
            keys: 'Ctrl S',
            run: () => player.toggleShuffle(),
          },
          {
            id: 'repeat',
            label: 'Repeat',
            keys: 'Ctrl R',
            run: () => player.cycleRepeat(),
          },
        ],
        [
          {
            id: 'up',
            label: 'Volume up',
            keys: 'Ctrl ↑',
            run: () => volume(0.1),
          },
          {
            id: 'down',
            label: 'Volume down',
            keys: 'Ctrl ↓',
            run: () => volume(-0.1),
          },
        ],
      ],
    },
    {
      name: 'Help',
      groups: [
        [
          {
            id: 'about',
            label: 'About wavebit',
            run: () => nav.go({ name: 'settings', section: 'about' }),
          },
          ctx.updateReady
            ? {
                id: 'updates',
                label: 'Restart to update',
                run: () => void window.wavebit.updates.install(),
              }
            : {
                id: 'updates',
                label: 'Check for updates',
                run: () => {
                  nav.go({ name: 'settings', section: 'about' });
                  void window.wavebit.updates.check();
                },
              },
          {
            id: 'shortcuts',
            label: 'Keyboard shortcuts',
            keys: 'Ctrl /',
            run: ctx.showShortcuts,
          },
        ],
      ],
    },
  ];
}

const volume = (delta: number) => {
  const el = document.querySelector<HTMLInputElement>('[data-volume]');
  player.setVolume(Number(el?.dataset.volume ?? 0.8) + delta);
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  );
}

/** One keydown handler for every shortcut the menus list. */
export function handleShortcut(
  event: KeyboardEvent,
  ctx: CommandContext,
): void {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key;
  const byId = Object.fromEntries(
    menus(ctx)
      .flatMap((m) => m.groups.flat())
      .map((c) => [c.id, c]),
  );
  const run = (id: string) => {
    event.preventDefault();
    byId[id]?.run();
  };
  if (key === 'Escape') {
    if (currentUi().fullPlayer) setUi({ fullPlayer: false });
    else if (nav.current().name === 'settings') nav.leaveSettings();
    return;
  }
  if (key === 'F5') return run('rescan');
  if (key === ' ' && !ctrl && !isTyping(event.target)) return run('toggle');
  if (!ctrl) return;
  const map: Record<string, string> = {
    o: 'add',
    q: 'quit',
    f: 'find',
    k: 'search',
    '1': 'home',
    '2': 'library',
    '3': 'explore',
    ',': 'settings',
    b: 'fold',
    s: 'shuffle',
    r: 'repeat',
    '/': 'shortcuts',
    ArrowRight: 'next',
    ArrowLeft: 'previous',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };
  const id = map[key.length === 1 ? key.toLowerCase() : key];
  if (!id) return;
  // Ctrl arrows move the caret while typing; leave them alone there.
  if (key.startsWith('Arrow') && isTyping(event.target)) return;
  run(id);
}
