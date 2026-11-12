import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channels, EVENT_NAMES, type EventName } from '../shared/ipc/channels';
import type { WavebitApi } from '../shared/ipc/api';

const invoke = (channel: string, input?: unknown) =>
  ipcRenderer.invoke(channel, input);

// Only these functions cross into the page. ipcRenderer itself is never exposed.
const api: WavebitApi = {
  platform: process.platform,
  app: {
    info: () => invoke(Channels.appInfo),
    setTitleBar: (colors) => invoke(Channels.appTitleBar, colors),
    quit: () => invoke(Channels.appQuit),
    setTray: (state) => invoke(Channels.appTray, state),
    refresh: (scope) => invoke(Channels.appRefresh, { scope }),
    copy: (text) => invoke(Channels.appCopy, { text }),
    fullScreen: (on) => invoke(Channels.appFullScreen, { on }),
  },
  settings: {
    get: () => invoke(Channels.settingsGet),
    set: (patch) => invoke(Channels.settingsSet, patch),
  },
  updates: {
    status: () => invoke(Channels.updatesStatus),
    check: () => invoke(Channels.updatesCheck),
    download: () => invoke(Channels.updatesDownload),
    install: () => invoke(Channels.updatesInstall),
    markSeen: () => invoke(Channels.updatesSeen),
    notes: (target) => invoke(Channels.updatesNotes, { target }),
    open: (page) => invoke(Channels.updatesOpen, { page }),
  },
  library: {
    state: () => invoke(Channels.libraryState),
    addFolder: () => invoke(Channels.libraryAddFolder),
    removeFolder: (path) => invoke(Channels.libraryRemoveFolder, { path }),
    scan: () => invoke(Channels.libraryScan),
    tracks: (query) => invoke(Channels.libraryTracks, query),
    albums: (query) => invoke(Channels.libraryAlbums, query),
    home: () => invoke(Channels.libraryHome),
    station: (query) => invoke(Channels.libraryStation, query),
    album: (key) => invoke(Channels.libraryAlbum, { key }),
    artists: (query) => invoke(Channels.libraryArtists, query),
    artist: (name) => invoke(Channels.libraryArtist, { name }),
    search: (query) => invoke(Channels.librarySearch, { query }),
    recordPlay: (id) => invoke(Channels.libraryRecordPlay, { id }),
    played: (song) => invoke(Channels.libraryPlayed, song),
    history: () => invoke(Channels.libraryHistory),
    listened: (report) => invoke(Channels.libraryListened, report),
    listening: () => invoke(Channels.libraryListening),
    loudness: (id) => invoke(Channels.libraryLoudness, { id }),
    showInFolder: (id) => invoke(Channels.libraryShowInFolder, { id }),
    openFolder: (path) => invoke(Channels.libraryOpenFolder, { path }),
    fileInfo: (id) => invoke(Channels.libraryFileInfo, { id }),
  },
  lyrics: {
    get: (song) => invoke(Channels.lyricsGet, song),
  },
  spotify: {
    status: () => invoke(Channels.spotifyStatus),
    signIn: () => invoke(Channels.spotifySignIn),
    cancelSignIn: () => invoke(Channels.spotifyCancelSignIn),
    signOut: () => invoke(Channels.spotifySignOut),
    playlists: () => invoke(Channels.spotifyPlaylists),
    playlist: (id, offset) => invoke(Channels.spotifyPlaylist, { id, offset }),
    canvas: (uri) => invoke(Channels.spotifyCanvas, { uri }),
    refresh: () => invoke(Channels.spotifyRefresh),
    albums: () => invoke(Channels.spotifyAlbums),
    artists: () => invoke(Channels.spotifyArtists),
    album: (id, offset) => invoke(Channels.spotifyAlbum, { id, offset }),
    saved: (uris) => invoke(Channels.spotifySaved, { uris }),
    save: (uris, saved) => invoke(Channels.spotifySave, { uris, saved }),
    artist: (id) => invoke(Channels.spotifyArtist, { id }),
    song: (id) => invoke(Channels.spotifySong, { id }),
    home: () => invoke(Channels.spotifyHome),
    recentMore: (before) => invoke(Channels.spotifyRecentMore, { before }),
    importPlaylist: (id) => invoke(Channels.spotifyImport, { id }),
    removeImport: (id) => invoke(Channels.spotifyRemoveImport, { id }),
    search: (query, offset) =>
      invoke(Channels.spotifySearch, { query, offset }),
  },
  youtube: {
    status: () => invoke(Channels.youtubeStatus),
    home: (next) => invoke(Channels.youtubeHome, { next }),
    explore: () => invoke(Channels.youtubeExplore),
    category: (params) => invoke(Channels.youtubeCategory, { params }),
    open: (videoId, browseId) =>
      invoke(Channels.youtubeOpen, { videoId, browseId }),
    library: () => invoke(Channels.youtubeLibrary),
    page: (browseId, next) => invoke(Channels.youtubePage, { browseId, next }),
    save: (playlistId, saved) =>
      invoke(Channels.youtubeSave, { playlistId, saved }),
    artist: (browseId) => invoke(Channels.youtubeArtist, { browseId }),
    match: (song) => invoke(Channels.youtubeMatch, song),
    radio: (videoId) => invoke(Channels.youtubeRadio, { videoId }),
    search: (query) => invoke(Channels.youtubeSearch, { query }),
    oauth: {
      status: () => invoke(Channels.youtubeOAuthStatus),
      configure: (clientId, clientSecret) =>
        invoke(Channels.youtubeOAuthConfigure, { clientId, clientSecret }),
      signIn: () => invoke(Channels.youtubeOAuthSignIn),
      cancel: () => invoke(Channels.youtubeOAuthCancel),
      signOut: () => invoke(Channels.youtubeOAuthSignOut),
    },
    googleAccount: () => invoke(Channels.youtubeGoogleAccount),
  },
  downloads: {
    state: () => invoke(Channels.downloadsState),
    add: (songs, list) => invoke(Channels.downloadsAdd, { songs, list }),
    cancel: (id) => invoke(Channels.downloadsCancel, { id }),
    cancelAll: () => invoke(Channels.downloadsCancelAll),
    remove: (id) => invoke(Channels.downloadsRemove, { id }),
    clear: () => invoke(Channels.downloadsClear),
    pause: () => invoke(Channels.downloadsPause),
    resume: () => invoke(Channels.downloadsResume),
    retry: (id) => invoke(Channels.downloadsRetry, { id }),
    retryFailed: () => invoke(Channels.downloadsRetryFailed),
    moveToTop: (id) => invoke(Channels.downloadsMoveToTop, { id }),
    delete: (id) => invoke(Channels.downloadsDelete, { id }),
    showInFolder: (id) => invoke(Channels.downloadsShowInFolder, { id }),
    locate: (id) => invoke(Channels.downloadsLocate, { id }),
    chooseFolder: () => invoke(Channels.downloadsChooseFolder),
    library: () => invoke(Channels.downloadsLibrary),
    openFolder: () => invoke(Channels.downloadsOpenFolder),
    deleteTrack: (id) => invoke(Channels.downloadsDeleteTrack, { id }),
  },
  party: {
    state: () => invoke(Channels.partyState),
    setMe: (me) => invoke(Channels.partyMe, me),
    create: (autoplay) => invoke(Channels.partyCreate, { autoplay }),
    join: (text) => invoke(Channels.partyJoin, { text }),
    leave: () => invoke(Channels.partyLeave),
    control: (control) => invoke(Channels.partyControl, control),
    acceptInvite: () => invoke(Channels.partyAcceptInvite),
    declineInvite: () => invoke(Channels.partyDeclineInvite),
    probe: () => invoke(Channels.partyProbe),
    resync: () => invoke(Channels.partyResync),
  },
  on(event, listener) {
    if (!EVENT_NAMES.includes(event as EventName))
      throw new Error(`Unknown event ${event}`);
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) =>
      listener(args[0] as never);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
};

contextBridge.exposeInMainWorld('wavebit', api);
