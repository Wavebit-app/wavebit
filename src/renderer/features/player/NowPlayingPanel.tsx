import { Eye, EyeOff, Heart, Maximize2, X } from 'lucide-react';
import { activeLine, primaryArtist } from '../../../shared/lrc';
import type { LyricLine } from '../../../shared/schemas/lyrics';
import { nav, type Route } from '../../app/router';
import { setUi } from '../../app/ui';
import { Artwork } from '../../design/Artwork';
import { OnDevice, SongArt, SongMark } from '../downloads/SongArt';
import { menuOn } from '../../design/ContextMenu';
import { cachedArt, count } from '../../lib/format';
import {
  useArtistProfile,
  useLyrics,
  useSaved,
  useSaveTrack,
  useSignedIn,
  useSpotifyArtist,
  useSpotifySong,
  useYtArtist,
  useSettings,
} from '../../lib/queries';
import { songMenu } from '../menus/menus';
import { SpotifyCanvas } from './Canvas';
import { PartyButton, PartyStrip } from '../party/PartyBits';
import { IconButton } from './controls';
import { player, usePlayer, useStreaming, type Playable } from './player';
import { VideoSlot } from './VideoSlot';
import { BACKDROP_MASK, useVideoStage, videoStage } from './videoStage';

const spotifyTrackId = (track: Playable) =>
  /^spotify:track:([A-Za-z0-9]{22})$/.exec(track.spotifyUri ?? '')?.[1] ?? '';

function ExpandButton({
  label,
  onPress,
  light = false,
}: {
  label: string;
  onPress: () => void;
  light?: boolean;
}) {
  return (
    <IconButton
      label={label}
      onPress={onPress}
      size={32}
      className={light ? 'text-white!' : ''}
    >
      <Maximize2 size={16} />
    </IconButton>
  );
}

/** The top of the drawer: the video, Canvas or cover, fading into the column. */
function Hero({ track }: { track: Playable }) {
  const source = usePlayer((s) => s.source);
  const streaming = useStreaming();
  const hidden = useVideoStage().hidden;
  const signedIn = useSignedIn();
  const id = spotifyTrackId(track);
  const uri = id ? `spotify:track:${id}` : '';
  const saved = useSaved(uri ? [uri] : [], signedIn).data?.get(uri);
  const save = useSaveTrack();
  return (
    <section
      aria-label="Now playing"
      onContextMenu={menuOn(() => songMenu(track))}
      className="relative h-[400px] shrink-0 overflow-hidden"
    >
      {streaming && !hidden ? (
        <VideoSlot backdrop="hero" className="absolute inset-0" />
      ) : (
        <div
          aria-hidden
          style={{ maskImage: BACKDROP_MASK }}
          className="absolute inset-0 overflow-hidden"
        >
          <Artwork
            src={track.artwork}
            className="size-full"
            rounded="rounded-none"
          />
          <SpotifyCanvas uri={track.spotifyUri} scrim={false} />
        </div>
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[90px] bg-linear-to-b from-black/50 to-transparent"
      />
      <div className="relative z-20 flex h-[60px] items-center gap-1 pr-2 pl-4 text-white">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {source ?? 'Now playing'}
        </span>
        <PartyButton className="text-white!" />
        <ExpandButton
          light
          label="Open the full-screen player"
          onPress={() => setUi({ fullPlayer: true })}
        />
        <IconButton
          label="Close the drawer"
          onPress={() => setUi({ panel: null })}
          size={32}
          className="text-white!"
        >
          <X size={18} />
        </IconButton>
      </div>
      <div className="absolute inset-x-0 bottom-3 z-20 flex items-start gap-1 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[1.4667rem] leading-tight font-bold tracking-[-0.01em]">
              {track.title}
            </h2>
            <SongMark track={track} size={18} />
          </div>
          <p className="mt-0.5 truncate text-sm">{track.artist}</p>
        </div>
        {streaming && (
          <IconButton
            label={hidden ? 'Show video' : 'Hide video'}
            onPress={() => videoStage.setHidden(!hidden)}
            size={32}
          >
            {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
          </IconButton>
        )}
        {saved !== undefined && (
          <IconButton
            label={saved ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            active={saved}
            onPress={() => save.mutate({ uri, saved: !saved })}
            size={32}
          >
            <Heart size={20} fill={saved ? 'currentColor' : 'none'} />
          </IconButton>
        )}
      </div>
    </section>
  );
}

function LyricsPreview({
  lines,
  synced,
}: {
  lines: LyricLine[];
  synced: boolean;
}) {
  const at = usePlayer((s) =>
    synced ? activeLine(lines, s.position * 1000) : 0,
  );
  const [now, next] = lines.slice(Math.max(at, 0)).filter((l) => l.text);
  return (
    <div className="relative px-4 text-[1.4667rem] leading-tight tracking-[-0.01em] text-white">
      <p className="mt-2 font-bold">{now?.text}</p>
      <p className="mt-2.5 font-semibold opacity-50">{next?.text}</p>
    </div>
  );
}

/** The song's words on a wash of its cover. Left out when there are none. */
function LyricsCard({ track }: { track: Playable }) {
  const found = useLyrics(track).data;
  const syncedLyrics = useSettings().data?.syncedLyrics ?? true;
  if (!found || found.kind === 'instrumental') return null;
  return (
    <section
      aria-label="Lyrics"
      className="relative h-[168px] shrink-0 overflow-hidden rounded-md bg-neutral-800"
    >
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {track.artwork && (
          <img
            src={cachedArt(track.artwork)}
            alt=""
            draggable={false}
            className="art-blur size-full scale-150 transform-gpu object-cover blur-2xl saturate-150"
          />
        )}
        <div className="absolute inset-0 bg-black/60" />
      </div>
      <div className="relative flex h-10 items-center pt-2 pr-2 pl-4">
        <h3 className="flex-1 text-sm font-semibold text-white">Lyrics</h3>
        <ExpandButton
          light
          label="Open the lyrics full screen"
          onPress={() => setUi({ fullPlayer: true, fullLyrics: true })}
        />
      </div>
      <LyricsPreview
        lines={found.lines}
        synced={found.kind === 'synced' && syncedLyrics}
      />
    </section>
  );
}

interface About {
  name: string;
  image: string | null;
  stat: string | null;
  bio: string | null;
  route: Route;
}

/**
 * Who sings this, asked only while the drawer is open: Spotify's artist for a
 * Spotify song, otherwise YouTube Music's by name. A file opens the library's
 * own artist page, whatever the picture and words came from.
 */
function useAboutArtist(track: Playable): About | null {
  const signedIn = useSignedIn();
  const songId = spotifyTrackId(track);
  const askSpotify = signedIn && !!songId;
  const song = useSpotifySong(songId, askSpotify);
  const artistId = song.data?.artistIds.find(Boolean) ?? '';
  const spotify = useSpotifyArtist(artistId, signedIn && !!artistId);

  const name = primaryArtist(track.artist);
  const askYouTube =
    !(askSpotify && song.isPending) && (!artistId || spotify.isError);
  const person = useArtistProfile(askYouTube ? name : '').data;
  const ytId = person?.browseId ?? '';
  const yt = useYtArtist(ytId, !!ytId).data;

  const own: Route = { name: 'artist', artist: track.artist };
  if (spotify.data) {
    const a = spotify.data;
    return {
      name: a.name,
      image: a.imageUrl,
      stat:
        a.monthlyListeners !== null
          ? `${a.monthlyListeners.toLocaleString()} monthly listeners`
          : a.followers !== null
            ? count(a.followers, 'follower')
            : null,
      bio: a.biography,
      route: { name: 'spotifyArtist', id: artistId },
    };
  }
  if (yt)
    return {
      name: yt.name,
      // Google refuses some larger sizes of these photos; 600 always loads.
      image:
        (yt.imageUrl ?? person?.imageUrl)?.replace(
          /=w\d+-h\d+/,
          '=w600-h600',
        ) ?? null,
      stat:
        yt.subscribers && /^[\d.,]+[KMB]?$/i.test(yt.subscribers)
          ? `${yt.subscribers} subscribers`
          : yt.subscribers,
      bio: yt.description,
      route: track.local ? own : { name: 'ytArtist', id: ytId },
    };
  return track.local
    ? { name: track.artist, image: null, stat: null, bio: null, route: own }
    : null;
}

function AboutCard({ track }: { track: Playable }) {
  const about = useAboutArtist(track);
  if (!about) return null;
  return (
    <section
      aria-label="About the artist"
      className="shrink-0 overflow-hidden rounded-md bg-foreground/5"
    >
      <div className="relative h-[190px]">
        <Artwork
          key={about.image}
          src={about.image}
          className="size-full"
          rounded="rounded-none"
        />
        <div className="absolute inset-x-0 top-0 flex h-12 items-center bg-linear-to-b from-black/50 to-transparent pr-2 pl-4 text-white">
          <h3 className="flex-1 text-sm font-semibold">About the artist</h3>
          <ExpandButton
            light
            label={`Open ${about.name}’s page`}
            onPress={() => nav.go(about.route)}
          />
        </div>
      </div>
      <div className="px-4 pt-3 pb-4">
        <p className="truncate text-base font-semibold">{about.name}</p>
        {about.stat && (
          <p className="mt-0.5 text-[0.8667rem] text-muted">{about.stat}</p>
        )}
        {about.bio && <p className="mt-2 line-clamp-3 text-sm">{about.bio}</p>}
      </div>
    </section>
  );
}

function NextCard() {
  const upNext = usePlayer((s) => s.upNext);
  usePlayer((s) => s.queue);
  usePlayer((s) => s.index);
  usePlayer((s) => s.shuffle);
  const rows = [
    ...upNext.map((track, i) => ({
      track,
      play: () => player.playAdded(i),
    })),
    ...player.upcoming().map(({ track, index }) => ({
      track,
      play: () => player.playAt(index),
    })),
  ].slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="Next in queue"
      className="shrink-0 rounded-md bg-foreground/5 py-2 pr-2 pl-4"
    >
      <div className="flex h-8 items-center">
        <h3 className="flex-1 text-sm font-semibold">Next in queue</h3>
        <ExpandButton
          label="Open the queue"
          onPress={() => setUi({ panel: 'queue' })}
        />
      </div>
      {rows.map(({ track, play }, i) => (
        <button
          key={`${track.id}-${i}`}
          type="button"
          onClick={play}
          onContextMenu={menuOn(() => songMenu(track))}
          aria-label={`Play ${track.title} now`}
          className="flex h-[52px] w-full items-center gap-2.5 text-left"
        >
          <SongArt track={track} src={track.artwork} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">
                {track.title}
              </span>
              <OnDevice track={track} />
            </span>
            <span className="truncate text-[0.8667rem] text-muted">
              {track.artist}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}

/**
 * DESIGN.md › Now playing drawer: one scrolling column in the queue's place.
 * The video, Canvas or cover, Lyrics, About the artist and Next in queue, each
 * with an expand button to its own full view.
 */
export function NowPlayingPanel({
  className = 'w-[var(--drawer-width,360px)] rounded-panel bg-surface',
}: {
  className?: string;
}) {
  const track = usePlayer((s) => s.queue[s.index]);
  return (
    <aside
      aria-label="Now playing"
      className={`flex ${className} shrink-0 flex-col overflow-hidden`}
    >
      <div data-video-scroll className="flex-1 overflow-y-auto">
        {track ? (
          <div className="flex flex-col gap-3 pb-4">
            <Hero track={track} />
            <div className="flex flex-col gap-3 px-4">
              <PartyStrip />
              <LyricsCard key={track.id} track={track} />
              <AboutCard track={track} />
              <NextCard />
            </div>
          </div>
        ) : (
          <p className="p-5 text-sm text-muted">
            Play a song and it shows here.
          </p>
        )}
      </div>
    </aside>
  );
}
