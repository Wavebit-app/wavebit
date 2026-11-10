import {
  ChevronDown,
  ListMusic,
  MicVocal,
  RectangleHorizontal,
  Square,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { nav } from '../../app/router';
import { setUi, useUi } from '../../app/ui';
import { Artwork } from '../../design/Artwork';
import { SongMark } from '../downloads/SongArt';
import { menuOn } from '../../design/ContextMenu';
import { songMenu } from '../menus/menus';
import { Backdrop } from '../../design/Backdrop';
import { useSettings } from '../../lib/queries';
import { useMotion } from '../../lib/useTheme';
import { useSizeClass } from '../../lib/useBreakpoint';
import { Lyrics } from '../lyrics/Lyrics';
import { IconButton, SeekBar, Transport, Volume } from './controls';
import { SpotifyCanvas } from './Canvas';
import { usePlayer, useStreaming } from './player';
import { VideoSlot } from './VideoSlot';
import { useVideoStage } from './videoStage';

/**
 * DESIGN.md › Full-screen player: the window goes full screen and the player
 * covers all of it (no title bar), with the artwork backdrop behind everything.
 */
export function FullPlayer() {
  const open = useUi((s) => s.fullPlayer);
  const track = usePlayer((s) => s.queue[s.index]);
  const source = usePlayer((s) => s.source);
  const compact = useSizeClass() === 'compact';
  const motionLevel = useMotion();
  // A hidden video leaves the full-screen player to the artwork, as for a file.
  const stage = useVideoStage();
  const streaming = useStreaming() && !stage.hidden;
  // A music video opens on its own, filling the player, as BitChord's does.
  const [theater, setTheater] = useState(true);
  const lyrics = useUi((s) => s.fullLyrics);
  const setLyrics = (fullLyrics: boolean) => setUi({ fullLyrics });
  const hideFrom = useSettings().data?.hidePlayingFrom ?? false;

  useEffect(() => {
    if (open && !track) setUi({ fullPlayer: false });
  }, [open, track]);
  if (!open || !track) return null;

  const close = () => setUi({ fullPlayer: false });
  const toAlbum = () => {
    if (track.albumKey) nav.go({ name: 'album', key: track.albumKey });
    close();
  };
  const toArtist = () => {
    nav.go({ name: 'artist', artist: track.artist });
    close();
  };
  const transition =
    motionLevel === 'off'
      ? { duration: 0 }
      : motionLevel === 'reduced'
        ? { duration: 0.15 }
        : { duration: 0.3, ease: [0.2, 0, 0, 1] as const };

  const lyricsToggle = (size: number, icon: number) => (
    <IconButton
      label={lyrics ? 'Hide lyrics' : 'Lyrics'}
      active={lyrics}
      onPress={() => setLyrics(!lyrics)}
      size={size}
    >
      <MicVocal size={icon} />
    </IconButton>
  );
  // The title, seek bar, transport and quiet row, beside the artwork or under it.
  const details = (roomy: boolean) => (
    <>
      {!hideFrom && (
        <button
          type="button"
          onClick={toAlbum}
          className={`self-start text-[0.8667rem] font-medium text-muted hover:text-foreground ${roomy ? '' : 'mt-5'}`}
        >
          {source ? `Playing from ${source}` : 'Now playing'}
        </button>
      )}
      <h1
        className={`font-semibold tracking-[-0.02em] ${roomy ? `${hideFrom ? '' : 'mt-3'} text-step` : `${hideFrom ? 'mt-5' : 'mt-1'} text-2xl`}`}
      >
        <span className="inline-flex max-w-full items-center gap-2.5">
          <span className="truncate">{track.title}</span>
          <SongMark track={track} size={20} />
        </span>
      </h1>
      <p className="mt-2 text-base text-muted">
        <button
          type="button"
          onClick={toArtist}
          className="font-medium text-foreground hover:text-accent"
        >
          {track.artist}
        </button>
        {track.album && (
          <>
            {' · '}
            <button
              type="button"
              onClick={toAlbum}
              className="hover:text-foreground"
            >
              {track.album}
            </button>
          </>
        )}
      </p>
      <div className={roomy ? 'mt-9' : 'mt-5'}>
        <SeekBar thick remaining />
      </div>
      <div className={roomy ? 'mt-5' : 'mt-3'}>
        <Transport scale={roomy ? 1.6 : 1.3} />
      </div>
      <div className={`flex items-center gap-2 ${roomy ? 'mt-7' : 'mt-4'}`}>
        {lyricsToggle(40, 18)}
        <IconButton
          label="Queue"
          onPress={() => setUi({ panel: 'queue', fullPlayer: false })}
          size={40}
        >
          <ListMusic size={18} />
        </IconButton>
        <Volume width={roomy ? 160 : 100} />
        <span className="flex-1" />
        {streaming && (
          <IconButton
            label="Video on its own"
            onPress={() => {
              setTheater(true);
              setLyrics(false);
            }}
            size={40}
          >
            <RectangleHorizontal size={18} />
          </IconButton>
        )}
        <IconButton label="Collapse player (Esc)" onPress={close} size={40}>
          <ChevronDown size={20} />
        </IconButton>
      </div>
    </>
  );

  return (
    <motion.section
      role="dialog"
      aria-label="Now playing"
      initial={motionLevel === 'full' ? { y: '100%' } : { opacity: 0 }}
      animate={motionLevel === 'full' ? { y: 0 } : { opacity: 1 }}
      transition={transition}
      className="absolute inset-0 z-40 overflow-hidden rounded-tl-md bg-surface"
    >
      <Backdrop src={track.artwork} fill />
      <SpotifyCanvas uri={track.spotifyUri} />
      {compact ? (
        <div className="relative flex h-full flex-col px-6 pt-safe pb-[calc(34px+env(safe-area-inset-bottom,0px))]">
          <header className="-mx-3 flex h-14 items-center justify-between">
            <IconButton label="Collapse player" onPress={close} size={44}>
              <ChevronDown size={24} />
            </IconButton>
            {!hideFrom && (
              <button
                type="button"
                onClick={toAlbum}
                className="truncate text-[0.8667rem] font-medium text-muted"
              >
                {source ? `Playing from ${source}` : 'Now playing'}
              </button>
            )}
            <span className="w-11" />
          </header>
          {streaming ? (
            <VideoSlot className="mt-4 aspect-video w-full shrink-0 rounded-md" />
          ) : (
            !lyrics && (
              <Artwork
                src={track.artwork}
                onContextMenu={menuOn(() => songMenu(track))}
                className="mt-4 aspect-square w-full"
                rounded="rounded-md"
              />
            )
          )}
          {lyrics && (
            <div className="lyrics-centered mt-4 flex min-h-0 flex-1 flex-col">
              <Lyrics size="panel" />
            </div>
          )}
          <h1 className="mt-7 flex items-center gap-2 text-2xl font-semibold">
            <span className="truncate">{track.title}</span>
            <SongMark track={track} size={20} />
          </h1>
          <button
            type="button"
            onClick={toArtist}
            className="mt-1 self-start text-base text-muted"
          >
            {track.artist}
          </button>
          <div className="mt-6">
            <SeekBar thick remaining />
          </div>
          <div className="mt-3">
            <Transport scale={1.4} />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-3">
            <Volume width={140} />
            {lyricsToggle(44, 22)}
            <IconButton
              label="Queue"
              onPress={() => setUi({ panel: 'queue', fullPlayer: false })}
              size={44}
            >
              <ListMusic size={22} />
            </IconButton>
          </div>
        </div>
      ) : lyrics ? (
        // One centred group, as BitChord's: the artwork column, then at most 38vw of lyrics.
        <div className="relative grid h-full grid-cols-[min(400px,34vw)_minmax(0,38vw)] grid-rows-[minmax(0,1fr)] justify-center gap-x-[clamp(48px,7vw,144px)] px-[clamp(24px,9vw,144px)]">
          <div className="flex min-h-0 flex-col justify-center overflow-y-auto py-12">
            {streaming ? (
              <VideoSlot className="aspect-video w-full rounded-md" />
            ) : (
              <Artwork
                src={track.artwork}
                onContextMenu={menuOn(() => songMenu(track))}
                className="aspect-square w-[min(320px,100%,38vh)]"
                rounded="rounded-md"
              />
            )}
            {details(false)}
          </div>
          <section
            aria-label="Lyrics"
            className="lyrics-centered flex min-h-0 min-w-0 flex-col pb-6"
          >
            <Lyrics size="full" />
          </section>
        </div>
      ) : streaming && theater ? (
        <div className="relative flex h-full flex-col">
          <VideoSlot className="min-h-0 flex-1" />
          <div className="flex shrink-0 items-center gap-8 bg-surface px-10 py-5">
            <div className="flex min-w-0 flex-[0_1_320px] flex-col">
              <span className="truncate text-lg font-semibold">
                {track.title}
              </span>
              <button
                type="button"
                onClick={toArtist}
                className="self-start truncate text-muted hover:text-foreground"
              >
                {track.artist}
              </button>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Transport scale={1.2} />
              <SeekBar remaining />
            </div>
            <div className="flex items-center gap-2">
              <Volume width={120} />
              {lyricsToggle(40, 18)}
              <IconButton
                label="Show the details beside the video"
                onPress={() => setTheater(false)}
                size={40}
              >
                <Square size={18} />
              </IconButton>
              <IconButton
                label="Queue"
                onPress={() => setUi({ panel: 'queue', fullPlayer: false })}
                size={40}
              >
                <ListMusic size={18} />
              </IconButton>
              <IconButton
                label="Collapse player (Esc)"
                onPress={close}
                size={40}
              >
                <ChevronDown size={20} />
              </IconButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full flex-wrap items-center justify-center gap-16 overflow-y-auto p-12">
          {streaming ? (
            <VideoSlot className="aspect-video w-[min(640px,48vw)] rounded-md" />
          ) : (
            <Artwork
              src={track.artwork}
              onContextMenu={menuOn(() => songMenu(track))}
              className="aspect-square w-[min(480px,40vw,60vh)]"
              rounded="rounded-md"
            />
          )}
          <div className="flex w-full max-w-[440px] flex-col">
            {details(true)}
          </div>
        </div>
      )}
    </motion.section>
  );
}
