import { enabledSources } from '../../shared/lyricsSources';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { Events } from '../../shared/ipc/channels';
import type { ScanProgress, SongSort } from '../../shared/schemas/library';
import type { SettingsPatch } from '../../shared/schemas/settings';
import type { SpotifyStatus } from '../../shared/schemas/spotify';
import type { NotesTarget } from '../../shared/schemas/updates';
import type { Playable } from '../features/player/player';

const api = () => window.wavebit;
export const PAGE = 200;

export const keys = {
  appInfo: ['app', 'info'] as const,
  settings: ['settings'] as const,
  updateStatus: ['updates', 'status'] as const,
  releaseNotes: (target: NotesTarget, version: string | undefined) =>
    ['updates', 'notes', target, version] as const,
  library: ['library'] as const,
  libraryState: ['library', 'state'] as const,
  tracks: (query: string, sort: SongSort) =>
    ['library', 'tracks', query, sort] as const,
  albums: (query: string) => ['library', 'albums', query] as const,
  home: ['library', 'home'] as const,
  album: (key: string) => ['library', 'album', key] as const,
  artists: (query: string) => ['library', 'artists', query] as const,
  artist: (name: string) => ['library', 'artist', name] as const,
  search: (query: string) => ['library', 'search', query] as const,
  listening: ['library', 'listening'] as const,
  downloaded: ['library', 'downloaded'] as const,
  spotifyStatus: ['spotify', 'status'] as const,
  playlists: ['spotify', 'playlists'] as const,
  playlist: (id: string) => ['spotify', 'playlist', id] as const,
  spotifyAlbums: ['spotify', 'albums'] as const,
  spotifyArtists: ['spotify', 'artists'] as const,
  spotifyAlbum: (id: string) => ['spotify', 'album', id] as const,
  spotifyArtist: (id: string) => ['spotify', 'artist', id] as const,
  spotifySong: (id: string) => ['spotify', 'song', id] as const,
  spotifyHome: ['spotify', 'home'] as const,
  saved: (uris: string[]) => ['spotify', 'saved', uris.join(',')] as const,
  ytStatus: ['youtube', 'status'] as const,
  ytLibrary: ['youtube', 'library'] as const,
  ytPage: (id: string) => ['youtube', 'page', id] as const,
  ytArtist: (id: string) => ['youtube', 'artist', id] as const,
  ytHome: ['youtube', 'home'] as const,
  ytExplore: ['youtube', 'explore'] as const,
  ytCategory: (params: string) => ['youtube', 'category', params] as const,
};

// --- Scan progress pushed from the main process ------------------------------

let progress: ScanProgress = { running: false, seen: 0, total: 0 };
const progressListeners = new Set<() => void>();

export function useScanProgress(): ScanProgress {
  return useSyncExternalStore(
    (l) => (progressListeners.add(l), () => progressListeners.delete(l)),
    () => progress,
  );
}

/** Subscribes once to main-process events and keeps the query cache in step. */
export function useMainEvents(client: QueryClient): void {
  useEffect(() => {
    const offs = [
      api().on(Events.scanProgress, (p) => {
        progress = p;
        for (const l of progressListeners) l();
      }),
      // Every library view (and Spotify matching) depends on the files.
      api().on(Events.libraryChanged, () => {
        void client.invalidateQueries({ queryKey: keys.library });
        void client.invalidateQueries({ queryKey: ['spotify', 'playlist'] });
        void client.invalidateQueries({ queryKey: ['spotify', 'album'] });
        void client.invalidateQueries({ queryKey: ['spotify', 'artist'] });
        void client.invalidateQueries({ queryKey: ['youtube', 'page'] });
      }),
      // A play changes Top Picks and Recently Played at once.
      api().on(Events.playsChanged, () => {
        void client.invalidateQueries({ queryKey: keys.home });
        void client.invalidateQueries({ queryKey: ['library', 'history'] });
      }),
      api().on(Events.listeningChanged, () => {
        void client.invalidateQueries({ queryKey: keys.listening });
      }),
      api().on(Events.updateStatus, (status) => {
        client.setQueryData(keys.updateStatus, status);
      }),
      api().on(Events.spotifyStatus, (status) => {
        client.setQueryData(keys.spotifyStatus, status);
        if (status.state !== 'signed_in')
          client.removeQueries({ queryKey: ['spotify', 'playlist'] });
        void client.invalidateQueries({ queryKey: keys.playlists });
      }),
      // A new YouTube account (or none) means a different home feed.
      api().on(Events.youtubeStatus, (status) => {
        client.setQueryData(keys.ytStatus, status);
        if (status.state !== 'signing_in')
          void client.resetQueries({ queryKey: ['youtube'] });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);
}

// --- App and settings --------------------------------------------------------

export const useAppInfo = () =>
  useQuery({
    queryKey: keys.appInfo,
    queryFn: () => api().app.info(),
    staleTime: Infinity,
  });

export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: () => api().settings.get(),
    staleTime: Infinity,
  });

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api().settings.set(patch),
    onSuccess: (settings) => client.setQueryData(keys.settings, settings),
  });
}

// --- Updates -----------------------------------------------------------------

export const useUpdateStatus = () =>
  useQuery({
    queryKey: keys.updateStatus,
    queryFn: () => api().updates.status(),
    staleTime: Infinity,
  });

/** Live from the release each time it's shown; the main process falls back to a saved copy. */
export const useReleaseNotes = (
  target: NotesTarget,
  version: string | undefined,
) =>
  useQuery({
    queryKey: keys.releaseNotes(target, version),
    queryFn: () => api().updates.notes(target),
    enabled: !!version,
    staleTime: 0,
    refetchOnMount: 'always',
  });

// --- Library -----------------------------------------------------------------

export const useLibraryState = () =>
  useQuery({
    queryKey: keys.libraryState,
    queryFn: () => api().library.state(),
  });

export function useSongs(query: string, sort: SongSort) {
  return useInfiniteQuery({
    queryKey: keys.tracks(query, sort),
    queryFn: ({ pageParam }) =>
      api().library.tracks({ query, sort, offset: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + PAGE < last.total ? last.offset + PAGE : undefined,
    placeholderData: keepPreviousData,
  });
}

export const useAlbums = (query: string) =>
  useQuery({
    queryKey: keys.albums(query),
    queryFn: () => api().library.albums({ query, offset: 0, limit: 200 }),
    placeholderData: keepPreviousData,
  });

/**
 * Home's shelves and Top Picks: one local SQLite read, so it is read again
 * each time a page using it opens, and Recently Played keeps up with playback.
 */
export const useHome = () =>
  useQuery({
    queryKey: keys.home,
    queryFn: () => api().library.home(),
    staleTime: 0,
  });

export const useListening = () =>
  useQuery({
    queryKey: keys.listening,
    queryFn: () => api().library.listening(),
  });

export const useDownloaded = () =>
  useQuery({
    queryKey: keys.downloaded,
    queryFn: () => api().downloads.library(),
  });

export function useDeleteDownloaded() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api().downloads.deleteTrack(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.downloaded }),
  });
}

export const useAlbum = (key: string) =>
  useQuery({
    queryKey: keys.album(key),
    queryFn: () => api().library.album(key),
  });

export const useArtists = (query: string) =>
  useQuery({
    queryKey: keys.artists(query),
    queryFn: () => api().library.artists({ query, offset: 0, limit: 200 }),
    placeholderData: keepPreviousData,
  });

export const useArtist = (name: string) =>
  useQuery({
    queryKey: keys.artist(name),
    queryFn: () => api().library.artist(name),
  });

export const useSearch = (query: string) =>
  useQuery({
    queryKey: keys.search(query),
    queryFn: () => api().library.search(query),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
  });

export function useAddFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api().library.addFolder(),
    onSuccess: (result) => {
      if (result.ok) client.setQueryData(keys.libraryState, result.state);
      void client.invalidateQueries({ queryKey: keys.settings });
    },
  });
}

export function useRemoveFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api().library.removeFolder(path),
    onSuccess: (state) => {
      client.setQueryData(keys.libraryState, state);
      void client.invalidateQueries({ queryKey: keys.settings });
    },
  });
}

export const useRescan = () =>
  useMutation({ mutationFn: () => api().library.scan() });

// --- Spotify -----------------------------------------------------------------

export const useSpotifyStatus = () =>
  useQuery({
    queryKey: keys.spotifyStatus,
    queryFn: () => api().spotify.status(),
    staleTime: 60_000,
  });

export function useSignedIn(): boolean {
  return useSpotifyStatus().data?.state === 'signed_in';
}

export const usePlaylists = (enabled: boolean) =>
  useQuery({
    queryKey: keys.playlists,
    queryFn: () => api().spotify.playlists(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export function usePlaylist(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.playlist(id),
    queryFn: ({ pageParam }) => api().spotify.playlist(id, pageParam),
    enabled,
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Drops cached playlists in main, then refetches them here. */
export function useRefreshSpotify() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api().spotify.refresh(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.playlists });
      void client.invalidateQueries({ queryKey: ['spotify', 'playlist'] });
    },
  });
}

export const useCanvas = (uri: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['spotify', 'canvas', uri],
    queryFn: () => api().spotify.canvas(uri!),
    enabled: enabled && !!uri,
    staleTime: Infinity,
    retry: false,
  });

export function useSpotifyActions() {
  const client = useQueryClient();
  const set = (status: SpotifyStatus) =>
    client.setQueryData(keys.spotifyStatus, status);
  return {
    signIn: useMutation({
      mutationFn: () => api().spotify.signIn(),
      onSuccess: set,
    }),
    signOut: useMutation({
      mutationFn: () => api().spotify.signOut(),
      onSuccess: set,
    }),
    cancel: () => void api().spotify.cancelSignIn(),
  };
}

// --- YouTube Music -------------------------------------------------------------

export const useYtStatus = () =>
  useQuery({
    queryKey: keys.ytStatus,
    queryFn: () => api().youtube.status(),
    staleTime: 60_000,
  });

/** YouTube Music's home feed, page by page (the main process caches the first for 10 minutes). */
export const useYtHome = () =>
  useInfiniteQuery({
    queryKey: keys.ytHome,
    queryFn: ({ pageParam }) => api().youtube.home(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 10 * 60_000,
    retry: false,
  });

/**
 * Explore, live from YouTube Music. YouTube pushes nothing to a client, so
 * the page asks again every 2 minutes while it is open and when the window
 * comes back, and whenever it is pulled down.
 */
export const useYtExplore = () =>
  useQuery({
    queryKey: keys.ytExplore,
    queryFn: () => api().youtube.explore(),
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

/** One mood or genre's shelves: a card's cover and the page it opens. */
export const useYtCategory = (params: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.ytCategory(params),
    queryFn: () => api().youtube.category(params),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });

// --- Spotify library: albums, artists, hearts --------------------------------------

export const useSpotifyAlbums = (enabled: boolean) =>
  useQuery({
    queryKey: keys.spotifyAlbums,
    queryFn: () => api().spotify.albums(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useSpotifyArtists = (enabled: boolean) =>
  useQuery({
    queryKey: keys.spotifyArtists,
    queryFn: () => api().spotify.artists(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useSpotifyAlbum = (id: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: keys.spotifyAlbum(id),
    queryFn: ({ pageParam }) => api().spotify.album(id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * Whether each Spotify track on screen is in Liked Songs: one call per 40
 * URIs (GET /me/library/contains), not one per row.
 */
export function useSaved(uris: string[], enabled: boolean) {
  const tracks = uris.filter((u) => /^spotify:track:[A-Za-z0-9]{22}$/.test(u));
  return useQuery({
    queryKey: keys.saved(tracks),
    queryFn: async () => {
      const out = new Map<string, boolean>();
      for (let i = 0; i < tracks.length; i += 40) {
        const chunk = tracks.slice(i, i + 40);
        const answer = await api().spotify.saved(chunk);
        chunk.forEach((u, j) => out.set(u, answer[j] ?? false));
      }
      return out;
    },
    enabled: enabled && tracks.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

/** Saves or removes one track; the heart changes at once and goes back if Spotify refuses. */
export function useSaveTrack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ uri, saved }: { uri: string; saved: boolean }) =>
      api().spotify.save([uri], saved),
    onMutate: ({ uri, saved }) => {
      for (const [key, map] of client.getQueriesData<Map<string, boolean>>({
        queryKey: ['spotify', 'saved'],
      }))
        if (map?.has(uri))
          client.setQueryData(key, new Map(map).set(uri, saved));
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: ['spotify', 'saved'] }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.playlist('liked') });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

// --- YouTube Music library and pages --------------------------------------------

export const useYtLibrary = (enabled: boolean) =>
  useQuery({
    queryKey: keys.ytLibrary,
    queryFn: () => api().youtube.library(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useYtPage = (id: string) =>
  useInfiniteQuery({
    queryKey: keys.ytPage(id),
    queryFn: ({ pageParam }) => api().youtube.page(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 5 * 60_000,
    retry: false,
  });

export function useYtSave(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      playlistId,
      saved,
    }: {
      playlistId: string;
      saved: boolean;
    }) => api().youtube.save(playlistId, saved),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.ytPage(id) });
      void client.invalidateQueries({ queryKey: keys.ytLibrary });
    },
  });
}

export const useYtArtist = (id: string, enabled = true) =>
  useQuery({
    queryKey: keys.ytArtist(id),
    queryFn: () => api().youtube.artist(id),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

export const useSpotifyArtist = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.spotifyArtist(id),
    queryFn: () => api().spotify.artist(id),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

export const useSpotifyHome = (enabled: boolean) =>
  useQuery({
    queryKey: keys.spotifyHome,
    queryFn: () => api().spotify.home(),
    enabled,
    staleTime: 2 * 60_000,
    // Spotify pushes nothing to a client, so Home asks again while it is open.
    // Two minutes is what the main process caches recent plays for.
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

/** Older recent plays, fetched only when asked for. */
export const useSpotifyRecentMore = (start: number | null) =>
  useInfiniteQuery({
    queryKey: ['spotify', 'recentMore', start],
    queryFn: ({ pageParam }) => api().spotify.recentMore(pageParam),
    initialPageParam: start ?? 1,
    getNextPageParam: (last) => last.before ?? undefined,
    enabled: false,
    retry: false,
  });

/**
 * The artist YouTube Music finds by this name: their page and picture. Kept
 * for the session, since the sidebar and the drawer ask for the same people.
 */
export const useArtistProfile = (name: string) =>
  useQuery({
    queryKey: ['youtube', 'artistProfile', name],
    queryFn: async () => {
      const people = (await api().youtube.search(name))
        .flatMap((shelf) => shelf.items)
        .filter((item) => item.browseId?.startsWith('UC'));
      return (
        people.find((p) => p.title.toLowerCase() === name.toLowerCase()) ??
        people[0] ??
        null
      );
    },
    enabled: name.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

/** wavebit's own listening history; the sidebar's and Home's Recently Played. */
export const usePlayHistory = () =>
  useQuery({
    queryKey: ['library', 'history'],
    queryFn: () => api().library.history(),
    staleTime: 0,
    refetchInterval: 30_000,
  });

/** The playing song's words. Nothing is sent to the lyric sources until lyrics are opened. */
export const useLyrics = (
  track: Pick<
    Playable,
    'id' | 'title' | 'artist' | 'album' | 'durationMs' | 'stream'
  > | null,
) => {
  const settings = useSettings().data;
  const sources = settings
    ? enabledSources(settings.lyricsSourceOrder, settings.lyricsSourcesOff)
    : [];
  return useQuery({
    queryKey: ['lyrics', track?.id, track?.artist, sources],
    queryFn: () =>
      api().lyrics.get({
        title: track!.title,
        artist: track!.artist,
        album: track!.album,
        durationMs: Math.round(track!.durationMs),
        ...(track!.stream?.videoId && { videoId: track!.stream.videoId }),
      }),
    enabled: !!track && sources.length > 0,
    staleTime: Infinity,
    retry: false,
  });
};

export const useSpotifySong = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.spotifySong(id),
    queryFn: () => api().spotify.song(id),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

/** Adds a playlist from a link. */
export function useImportPlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api().spotify.importPlaylist(id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useRemoveImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api().spotify.removeImport(id),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: keys.playlists }),
  });
}

// --- Google sign-in through the browser (YouTube Data API) ----------------------

export const useYtOAuth = () =>
  useQuery({
    queryKey: ['youtube', 'oauth'],
    queryFn: () => api().youtube.oauth.status(),
    staleTime: 60_000,
  });

export const useGoogleAccount = (enabled: boolean) =>
  useQuery({
    queryKey: ['youtube', 'google'],
    queryFn: () => api().youtube.googleAccount(),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

export function useYtOAuthActions() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['youtube', 'oauth'] });
    void client.invalidateQueries({ queryKey: ['youtube', 'google'] });
  };
  return {
    configure: useMutation({
      mutationFn: (c: { clientId: string; clientSecret: string }) =>
        api().youtube.oauth.configure(c.clientId, c.clientSecret),
      onSettled: refresh,
    }),
    signIn: useMutation({
      mutationFn: () => api().youtube.oauth.signIn(),
      onSettled: refresh,
    }),
    signOut: useMutation({
      mutationFn: () => api().youtube.oauth.signOut(),
      onSettled: refresh,
    }),
    cancel: () => void api().youtube.oauth.cancel(),
  };
}

// --- Search beyond the files ----------------------------------------------------

export const useYtSearch = (query: string) =>
  useQuery({
    queryKey: ['youtube', 'search', query],
    queryFn: () => api().youtube.search(query),
    enabled: query.length > 0,
    staleTime: 10 * 60_000,
    // Refining a search holds its results; a different search starts empty.
    placeholderData: (previous, last) => {
      const before = String(last?.queryKey[2] ?? '').toLowerCase();
      const now = query.toLowerCase();
      return now.startsWith(before) || before.startsWith(now)
        ? previous
        : undefined;
    },
    retry: false,
  });

export const useSpotifySearch = (query: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ['spotify', 'search', query],
    queryFn: ({ pageParam }) => api().spotify.search(query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: enabled && query.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
