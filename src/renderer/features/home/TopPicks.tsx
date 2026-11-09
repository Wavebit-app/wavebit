import type { ReactElement, ReactNode } from 'react';
import type {
  StationQuery,
  TopPicks as Picks,
} from '../../../shared/schemas/library';
import type {
  SpotifyAlbum,
  SpotifyArtistPage,
} from '../../../shared/schemas/spotify';
import { nav } from '../../app/router';
import { DiscoveryArt, PersonalArt, RediscoverArt } from '../../design/PickArt';
import { ArtistCard, DrawnCard, ReleaseCard } from '../../design/PickCards';
import { menuOn, type MenuSpec } from '../../design/ContextMenu';
import { Shelf } from '../../design/Shelf';
import { artUrl, count } from '../../lib/format';
import {
  useSignedIn,
  useSpotifyArtist,
  useSpotifyHome,
  useYtHome,
} from '../../lib/queries';
import {
  localAlbumMenu,
  localArtistMenu,
  recentMenu,
  spotifyAlbumMenu,
  spotifyArtistMenu,
  stationMenu,
  ytItemMenu,
} from '../menus/menus';
import { fromLocal, player } from '../player/player';
import { playable } from '../spotify/PlaylistPage';
import { open as openYt } from '../youtube/YouTube';
import { openRecent } from './SpotifyShelves';

/** A station card shows only with enough songs behind it to be worth a queue. */
const MIN_STATION = 10;

const STATION = {
  personal: { Art: PersonalArt, eyebrow: '#ffd2da' },
  discovery: { Art: DiscoveryArt, eyebrow: '#cdbdff' },
  rediscover: { Art: RediscoverArt, eyebrow: '#b5fff3' },
} as const;

async function playStation(query: StationQuery, title: string) {
  const tracks = await window.wavebit.library.station(query);
  if (tracks.length) player.playList(tracks.map(fromLocal), 0, title);
}

function StationCard({
  kind,
  eyebrow,
  title,
  line,
  onPress,
}: {
  kind: keyof typeof STATION;
  eyebrow: string;
  title: string;
  line: string;
  /** Plays something else than the library's own station for this kind. */
  onPress?: () => void;
}) {
  const { Art, eyebrow: color } = STATION[kind];
  return (
    <DrawnCard
      art={<Art />}
      color={color}
      eyebrow={eyebrow}
      title={title}
      line={line}
      onPress={onPress ?? (() => void playStation({ kind }, title))}
    />
  );
}

/** The artist's newest release; on a tie, a single (it came out on its own). */
function newestRelease(artist: SpotifyArtistPage): SpotifyAlbum | null {
  return [...artist.singles, ...artist.albums].reduce<SpotifyAlbum | null>(
    (best, r) => (!best || (r.year ?? 0) > (best.year ?? 0) ? r : best),
    null,
  );
}

/** YouTube Music's own mixes for this account, as they appear in its home feed. */
const YT_MIX = /^(my supermix|my mix|discover mix|new release mix)/i;

/**
 * Home's "Top Picks for You" (BitChord's TopPicksShelf): tall 3:4 cards, built
 * like BitChord's from what the accounts say right now (Spotify's top artists
 * and recent plays, YouTube Music's mixes and new releases), then from the
 * files and their play counts. It reads the same queries as Home's shelves,
 * plus one artist page. A card with nothing behind it is left out.
 */
export function TopPicks({
  picks,
  name,
}: {
  /** The library's picks; null when it has no songs. */
  picks: Picks | null;
  /** The Spotify account's name, for "Sam’s Station". */
  name: string | null;
}) {
  const signedIn = useSignedIn();
  const spotify = useSpotifyHome(signedIn).data;
  const topArtists = spotify?.topArtists ?? [];
  const leadArtist = topArtists[0];
  const leadPage = useSpotifyArtist(
    leadArtist?.id ?? '',
    signedIn && !!leadArtist,
  ).data;
  const shelves = useYtHome().data?.pages.flatMap((p) => p.shelves) ?? [];

  const first = name?.trim().split(/\s+/)[0];
  const cards: ReactNode[] = [];
  const add = (menu: () => MenuSpec | null, card: ReactElement) =>
    cards.push(
      <div key={card.key} className="contents" onContextMenu={menuOn(menu)}>
        {card}
      </div>,
    );
  const station = first ? `${first}’s Station` : 'Your Station';
  const hasFiles = !!picks && picks.played + picks.unplayed > 0;
  const topSongs = spotify?.topTracks.map(playable) ?? [];

  // The lead card is always the newest thing there is, as on BitChord.
  const liveRelease = leadPage ? newestRelease(leadPage) : null;
  const ytRelease = shelves
    .find((s) => /new release/i.test(s.title))
    ?.items.find((i) => i.kind === 'album' && i.browseId?.startsWith('MPRE'));
  if (liveRelease && leadPage)
    add(
      () => spotifyAlbumMenu(liveRelease),
      <ReleaseCard
        key="live-release"
        art={liveRelease.imageUrl}
        eyebrow={`New from ${leadPage.name}`}
        title={liveRelease.name}
        line={liveRelease.year ? String(liveRelease.year) : ''}
        onPress={() => nav.go({ name: 'spotifyAlbum', id: liveRelease.id })}
      />,
    );
  else if (ytRelease)
    add(
      () => ytItemMenu(ytRelease),
      <ReleaseCard
        key="yt-release"
        art={ytRelease.imageUrl}
        eyebrow="New on YouTube Music"
        title={ytRelease.title}
        line={ytRelease.subtitle}
        onPress={() => openYt(ytRelease)}
      />,
    );

  if (hasFiles)
    add(
      () =>
        stationMenu(station, () => {
          void playStation({ kind: 'personal' }, station);
        }),
      <StationCard
        key="personal"
        kind="personal"
        eyebrow="Made for You"
        title={station}
        line={
          picks.played ? 'Your most played, shuffled' : 'Everything, shuffled'
        }
      />,
    );
  else if (topSongs.length > 0)
    add(
      () => stationMenu(station, () => player.shuffleList(topSongs, station)),
      <StationCard
        key="personal"
        kind="personal"
        eyebrow="Made for You"
        title={station}
        line="Your top songs on Spotify"
        onPress={() => player.shuffleList(topSongs, station)}
      />,
    );

  const jumpBack = spotify?.recent.find((r) => r.kind !== 'track');
  if (jumpBack)
    add(
      () => recentMenu(jumpBack),
      <ReleaseCard
        key="jump-back"
        art={jumpBack.imageUrl}
        eyebrow="Jump back in"
        title={jumpBack.name}
        line={jumpBack.subtitle ?? ''}
        onPress={() => openRecent(jumpBack, () => {})}
      />,
    );

  const release = picks?.latestRelease;
  if (release)
    add(
      () => localAlbumMenu(release),
      <ReleaseCard
        key="release"
        art={release.hasArt ? artUrl(release.key) : null}
        eyebrow={
          picks?.latestFromTop ? `New from ${release.artist}` : 'Just added'
        }
        title={release.title}
        line={[release.year, count(release.trackCount, 'song')]
          .filter(Boolean)
          .join(' · ')}
        onPress={() => nav.go({ name: 'album', key: release.key })}
      />,
    );

  // A different face from the release card when there is one.
  const liveArtist = topArtists[1] ?? topArtists[0];
  const artist = picks?.featuredArtist;
  if (liveArtist)
    add(
      () => spotifyArtistMenu(liveArtist),
      <ArtistCard
        key="live-artist"
        art={liveArtist.imageUrl}
        name={liveArtist.name}
        eyebrow="Your top artist"
        line="On Spotify"
        onPress={() => nav.go({ name: 'spotifyArtist', id: liveArtist.id })}
      />,
    );
  else if (artist)
    add(
      () => localArtistMenu(artist),
      <ArtistCard
        key="artist"
        art={artist.artKey ? artUrl(artist.artKey) : null}
        name={artist.name}
        eyebrow={`Featuring ${artist.name}`}
        line={`${count(artist.trackCount, 'song')}, shuffled`}
        onPress={() =>
          void playStation({ kind: 'artist', artist: artist.name }, artist.name)
        }
      />,
    );

  const mixes = shelves
    .flatMap((s) => s.items)
    .filter((i) => YT_MIX.test(i.title) && /^(VL|MPRE)/.test(i.browseId ?? ''))
    .filter((m, i, all) => all.findIndex((o) => o.title === m.title) === i)
    .slice(0, 3);
  for (const mix of mixes)
    add(
      () => ytItemMenu(mix),
      <ReleaseCard
        key={`mix-${mix.browseId}`}
        art={mix.imageUrl}
        eyebrow="Made for You"
        title={mix.title}
        line={mix.subtitle}
        onPress={() => openYt(mix)}
      />,
    );

  if (picks && picks.unplayed >= MIN_STATION)
    add(
      () =>
        stationMenu('Discovery Station', () => {
          void playStation({ kind: 'discovery' }, 'Discovery Station');
        }),
      <StationCard
        key="discovery"
        kind="discovery"
        eyebrow="Made for You"
        title="Discovery Station"
        line="Songs you haven’t played yet"
      />,
    );
  if (picks && picks.forgotten >= MIN_STATION)
    add(
      () =>
        stationMenu('Rediscover', () => {
          void playStation({ kind: 'rediscover' }, 'Rediscover');
        }),
      <StationCard
        key="rediscover"
        kind="rediscover"
        eyebrow="Made for You"
        title="Rediscover"
        line="Played before, not in two months"
      />,
    );
  if (cards.length === 0) return null;
  return (
    <Shelf title="Top Picks for You" kind="picks">
      {cards}
    </Shelf>
  );
}
