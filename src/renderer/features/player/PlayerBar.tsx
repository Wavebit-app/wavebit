import { useLayoutEffect } from 'react';
import {
  CirclePause,
  CirclePlay,
  ListMusic,
  Maximize2,
  MicVocal,
  PanelRight,
  SkipForward,
} from 'lucide-react';
import { setUi, useUi } from '../../app/ui';
import { OnDevice, SongArt } from '../downloads/SongArt';
import { menuOn } from '../../design/ContextMenu';
import { songMenu } from '../menus/menus';
import { useSettings } from '../../lib/queries';
import { IconButton, SeekBar, Transport, Volume } from './controls';
import { player, usePlayer } from './player';

function NowPlaying() {
  const index = usePlayer((s) => s.index);
  const queue = usePlayer((s) => s.queue);
  const error = usePlayer((s) => s.error);
  const track = queue[index];
  if (!track) return null;
  return (
    <button
      type="button"
      onClick={() => setUi({ fullPlayer: true })}
      onContextMenu={menuOn(() => songMenu(track))}
      aria-label={`Open the full-screen player for ${track.title}`}
      className="flex min-w-0 items-center gap-3 rounded-md text-left"
    >
      <SongArt
        track={track}
        src={track.artwork}
        size={48}
        rounded="rounded-md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{track.title}</span>
          <OnDevice track={track} />
        </span>
        <span
          className={`truncate text-[0.8667rem] ${error ? 'text-danger' : 'text-muted'}`}
        >
          {error ? 'This file is gone. Rescan your library.' : track.artist}
        </span>
      </span>
    </button>
  );
}

/** DESIGN.md › Player bar: under the workspace, hidden until something has played. */
export function PlayerBar() {
  const hasTrack = usePlayer((s) => s.index >= 0);
  const panel = useUi((s) => s.panel);
  const nowOpen = panel === 'now';
  const queueOpen = panel === 'queue';
  const lyricsOpen = panel === 'lyrics';
  const hideVolume = useSettings().data?.hideVolumeBar ?? false;
  // Side sheets end where this bar begins, and it isn't always there.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--player-bar-h', hasTrack ? '84px' : '0px');
    return () => {
      root.removeProperty('--player-bar-h');
    };
  }, [hasTrack]);
  if (!hasTrack) return null;
  return (
    <footer
      aria-label="Player"
      className="grid h-[84px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-6 pr-5 pl-3"
    >
      <NowPlaying />
      <div className="flex flex-col items-center justify-center gap-1">
        <Transport />
        <SeekBar />
      </div>
      <div className="flex items-center justify-end gap-2">
        <IconButton
          label={nowOpen ? 'Close the Now playing drawer' : 'Now playing'}
          active={nowOpen}
          onPress={() => setUi({ panel: nowOpen ? null : 'now' })}
          size={32}
        >
          <PanelRight size={18} />
        </IconButton>
        <IconButton
          label={lyricsOpen ? 'Close lyrics' : 'Lyrics'}
          active={lyricsOpen}
          onPress={() => setUi({ panel: lyricsOpen ? null : 'lyrics' })}
          size={32}
        >
          <MicVocal size={18} />
        </IconButton>
        <IconButton
          label={queueOpen ? 'Close queue' : 'Queue'}
          active={queueOpen}
          onPress={() => setUi({ panel: queueOpen ? null : 'queue' })}
          size={32}
        >
          <ListMusic size={18} />
        </IconButton>
        {!hideVolume && <Volume />}
        <IconButton
          label="Full-screen player"
          onPress={() => setUi({ fullPlayer: true })}
          size={32}
        >
          <Maximize2 size={16} />
        </IconButton>
      </div>
    </footer>
  );
}

/** DESIGN.md › Mini player: a floating card above the tab bar in compact windows. */
export function MiniPlayer() {
  const track = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const progress = usePlayer((s) =>
    s.duration > 0 ? s.position / s.duration : 0,
  );
  if (!track) return null;
  return (
    <div className="pointer-events-auto relative flex h-[60px] items-center gap-3 overflow-hidden rounded-2xl bg-overlay pr-1.5 pl-2.5 shadow-overlay">
      <button
        type="button"
        onClick={() => setUi({ fullPlayer: true })}
        onContextMenu={menuOn(() => songMenu(track))}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Open the full-screen player for ${track.title}`}
      >
        <SongArt
          track={track}
          src={track.artwork}
          size={40}
          rounded="rounded-md"
        />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{track.title}</span>
            <OnDevice track={track} />
          </span>
          <span className="truncate text-[0.8667rem] text-muted">
            {track.artist}
          </span>
        </span>
      </button>
      <IconButton
        label="Now playing"
        onPress={() => setUi({ panel: 'now' })}
        size={44}
      >
        <PanelRight size={20} />
      </IconButton>
      <IconButton
        label={playing ? 'Pause' : 'Play'}
        onPress={player.toggle}
        size={44}
      >
        {playing ? (
          <CirclePause size={30} strokeWidth={1.75} className="text-accent" />
        ) : (
          <CirclePlay size={30} strokeWidth={1.75} className="text-accent" />
        )}
      </IconButton>
      <IconButton label="Next" onPress={player.next} size={44}>
        <SkipForward size={20} />
      </IconButton>
      <span
        aria-hidden
        className="absolute right-4 bottom-0 left-4 h-0.5 bg-sunken"
      >
        <span
          className="block h-full bg-accent"
          style={{ width: `${progress * 100}%` }}
        />
      </span>
    </div>
  );
}
