import { useEffect, useRef } from 'react';
import { Events } from '../../../shared/ipc/channels';
import type { TrayCommand } from '../../../shared/schemas/tray';
import { nav } from '../../app/router';
import { searchInputId, setUi } from '../../app/ui';
import { player, usePlayer } from './player';

/** Tells the system tray what's playing, and carries out what its menu asks. */
export function useTrayBridge(toggleCloseToTray: () => void): void {
  const title = usePlayer((s) => s.queue[s.index]?.title ?? null);
  const artist = usePlayer((s) => s.queue[s.index]?.artist ?? '');
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);

  useEffect(() => {
    void window.wavebit.app
      .setTray({ title, artist, playing, shuffle, repeat })
      .catch(() => {});
  }, [title, artist, playing, shuffle, repeat]);

  const toggle = useRef(toggleCloseToTray);
  toggle.current = toggleCloseToTray;

  useEffect(() => {
    const run = (command: TrayCommand) => {
      switch (command) {
        case 'toggle':
          return player.toggle();
        case 'previous':
          return player.previous();
        case 'next':
          return player.next();
        case 'shuffle':
          return player.toggleShuffle();
        case 'repeat:off':
        case 'repeat:all':
        case 'repeat:one':
          return player.setRepeat(command.slice(7) as 'off' | 'all' | 'one');
        case 'nowPlaying':
          return setUi({ fullPlayer: true });
        case 'lyrics':
          return setUi({ panel: 'lyrics', fullPlayer: false });
        case 'queue':
          return setUi({ panel: 'queue', fullPlayer: false });
        case 'home':
          setUi({ fullPlayer: false });
          return nav.go({ name: 'home' });
        case 'library':
          setUi({ fullPlayer: false });
          return nav.go({ name: 'library', tab: 'overview' });
        case 'search':
          setUi({ fullPlayer: false });
          return document.getElementById(searchInputId)?.focus();
        case 'settings':
          setUi({ fullPlayer: false });
          return nav.go({ name: 'settings', section: 'playback' });
        case 'closeToTray':
          return toggle.current();
      }
    };
    return window.wavebit.on(Events.trayCommand, run);
  }, []);
}
