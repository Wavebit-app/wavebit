import type { SpotifyTrack } from '../../../shared/schemas/spotify';
import type { SpotifyLink } from '../../../shared/spotifyLink';
import { nav, type Route } from '../../app/router';

/** The page a Spotify link opens. */
export function spotifyRoute({ kind, id }: SpotifyLink): Route {
  switch (kind) {
    case 'playlist':
      return { name: 'playlist', id };
    case 'album':
      return { name: 'spotifyAlbum', id };
    case 'artist':
      return { name: 'spotifyArtist', id };
    case 'track':
      return { name: 'spotifySong', id };
  }
}

/** A Spotify row's links: each artist, the album and the song's own page, all inside wavebit. */
export function rowLinks(t: SpotifyTrack) {
  const song = /^spotify:track:([A-Za-z0-9]{22})$/.exec(t.uri)?.[1];
  const { albumId, localAlbumKey } = t;
  return {
    artistLinks: t.artists.map((name, i) => {
      const id = t.artistIds[i];
      return {
        name,
        open: id ? () => nav.go({ name: 'spotifyArtist', id }) : null,
      };
    }),
    onAlbum: albumId
      ? () => nav.go({ name: 'spotifyAlbum', id: albumId })
      : localAlbumKey
        ? () => nav.go({ name: 'album', key: localAlbumKey })
        : undefined,
    onDetails: song
      ? () => nav.go({ name: 'spotifySong', id: song })
      : undefined,
  };
}
