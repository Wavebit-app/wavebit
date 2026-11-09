import { nav } from '../../app/router';
import { menuOn } from '../../design/ContextMenu';
import { ListeningArt } from '../../design/PickArt';
import { ArtistCard, DrawnCard, ReleaseCard } from '../../design/PickCards';
import { Shelf } from '../../design/Shelf';
import { count, length } from '../../lib/format';
import { useListening } from '../../lib/queries';
import { songMenu } from '../menus/menus';
import { fromHistory, player } from '../player/player';

const plays = (n: number) => count(n, 'play');

/**
 * Library's headline facts, after BitChord's Replay cards, drawn as Home's Top
 * Picks are. Nothing shows before the first minute of listening, and a
 * category with no plays is left out rather than shown empty.
 */
export function ListeningCards() {
  const s = useListening().data;
  const minutes = Math.floor((s?.totalMs ?? 0) / 60_000);
  if (!s || minutes < 1) return null;
  const { topSong: song, topArtist: artist, topAlbum: album } = s;
  return (
    <div className="listen-area">
      <Shelf title="Your Listening" kind="listen">
        <DrawnCard
          art={<ListeningArt />}
          color="#cbd8ff"
          eyebrow="All time"
          title="Minutes listened"
          line={plays(s.totalPlays)}
        >
          <span className="absolute inset-x-4 top-[36%] -translate-y-1/2 text-center text-[2.6rem] leading-none font-bold tracking-[-0.02em] whitespace-nowrap tabular-nums">
            {minutes.toLocaleString()}
          </span>
        </DrawnCard>
        {song && (
          <div
            className="contents"
            onContextMenu={menuOn(() => songMenu(fromHistory(song)))}
          >
            <ReleaseCard
              art={song.artwork}
              eyebrow="Your top song"
              title={song.title}
              line={`${song.artist} · ${plays(song.plays)}`}
              onPress={() =>
                player.playList([fromHistory(song)], 0, song.title)
              }
            />
          </div>
        )}
        {artist && (
          <ArtistCard
            art={artist.artwork}
            name={artist.name}
            eyebrow="Your top artist"
            line={`${length(artist.ms)} · ${plays(artist.plays)}`}
            // Only what was streamed goes to search: names from files stay here.
            onPress={() =>
              nav.go(
                artist.localName
                  ? { name: 'artist', artist: artist.localName }
                  : { name: 'search', query: artist.name },
              )
            }
          />
        )}
        {album && (
          <ReleaseCard
            art={album.artwork}
            eyebrow="Your top album"
            title={album.title}
            line={`${album.artist} · ${length(album.ms)}`}
            onPress={() =>
              nav.go(
                album.albumKey
                  ? { name: 'album', key: album.albumKey }
                  : { name: 'search', query: `${album.title} ${album.artist}` },
              )
            }
          />
        )}
      </Shelf>
    </div>
  );
}
