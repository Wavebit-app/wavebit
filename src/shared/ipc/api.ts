import type {
  AddFolderResult,
  FileInfo,
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  HomeFeed,
  LibraryState,
  LocalTrack,
  ListQuery,
  Loudness,
  ScanProgress,
  ScanResult,
  SearchResults,
  StationQuery,
  TrackPage,
  TracksQuery,
  HistoryEntry,
  Listened,
  ListeningSummary,
  PlayedSong,
} from '../schemas/library';
import type {
  ChooseDownloadFolderResult,
  DownloadAddResult,
  DownloadedLibrary,
  DownloadList,
  DownloadLocation,
  DownloadsDelta,
  DownloadSong,
  DownloadsState,
} from '../schemas/downloads';
import type { Settings, SettingsPatch } from '../schemas/settings';
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyArtistPage,
  SpotifyHome,
  SpotifyPlaylist,
  SpotifyRecentPage,
  SpotifySong,
  SpotifyStatus,
  SpotifyTrackPage,
} from '../schemas/spotify';
import type { FoundLyrics, LyricsQuery } from '../schemas/lyrics';
import type { RefreshScope } from '../schemas/refresh';
import type { TrayCommand, TrayState } from '../schemas/tray';
import type {
  YtArtist,
  YtGoogleAccount,
  YtOAuthStatus,
  YtRadioSong,
  YtShelf,
  YtMatch,
  YtMatchQuery,
  YtHomePage,
  YtExplore,
  YtLibrary,
  YtPage,
  YtStatus,
} from '../schemas/youtube';
import type {
  NotesTarget,
  ReleaseNotes,
  UpdatePage,
  UpdateStatus,
} from '../schemas/updates';
import type {
  PartyControl,
  PartyMe,
  PartyProbe,
  PartyState,
} from '../schemas/party';
import type { Events } from './channels';

export interface AppInfo {
  /** False where the desktop has no system tray, so closing the window quits. */
  trayAvailable: boolean;
  name: string;
  version: string;
  platform: string;
  arch: string;
  nativeVersion: string;
}

export interface TitleBarColors {
  color: string;
  symbolColor: string;
}

export interface EventPayloads {
  [Events.spotifyStatus]: SpotifyStatus;
  [Events.youtubeStatus]: YtStatus;
  [Events.scanProgress]: ScanProgress;
  [Events.libraryChanged]: ScanResult;
  [Events.playsChanged]: null;
  [Events.listeningChanged]: null;
  [Events.trayCommand]: TrayCommand;
  [Events.downloadsChanged]: DownloadsDelta;
  [Events.updateStatus]: UpdateStatus;
  /** The window left the full screen the full-screen player put it in. */
  [Events.leftFullScreen]: null;
  [Events.partyChanged]: PartyState;
  /** An invite link was opened: show the Listen together drawer. */
  [Events.partyOpen]: null;
}

/** What the preload exposes as `window.wavebit`. */
export interface WavebitApi {
  platform: string;
  app: {
    info(): Promise<AppInfo>;
    setTitleBar(colors: TitleBarColors): Promise<void>;
    quit(): Promise<void>;
    /** Tells the system tray what's playing. */
    setTray(state: TrayState): Promise<void>;
    refresh(scope: RefreshScope): Promise<void>;
    /** Puts text on the clipboard; the page itself has no clipboard permission. */
    copy(text: string): Promise<void>;
    /** The full-screen player takes the whole screen, title bar and all. */
    fullScreen(on: boolean): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: SettingsPatch): Promise<Settings>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    /** Closes wavebit, installs the downloaded update and opens it. */
    install(): Promise<UpdateStatus>;
    /** What's new was pressed. */
    markSeen(): Promise<UpdateStatus>;
    notes(target: NotesTarget): Promise<ReleaseNotes | null>;
    open(page: UpdatePage): Promise<void>;
  };
  library: {
    state(): Promise<LibraryState>;
    addFolder(): Promise<AddFolderResult>;
    removeFolder(path: string): Promise<LibraryState>;
    scan(): Promise<ScanResult>;
    tracks(query: TracksQuery): Promise<TrackPage>;
    albums(query: ListQuery): Promise<AlbumSummary[]>;
    /** Home's shelves and Top Picks, from the library and its play history. */
    home(): Promise<HomeFeed>;
    /** A Top Picks station's queue, shuffled in Rust. */
    station(query: StationQuery): Promise<LocalTrack[]>;
    album(key: string): Promise<AlbumDetail | null>;
    artists(query: ListQuery): Promise<ArtistSummary[]>;
    artist(name: string): Promise<ArtistDetail | null>;
    search(query: string): Promise<SearchResults>;
    recordPlay(id: string): Promise<void>;
    /** Adds a song to wavebit's own listening history, once it has been listened to. */
    played(song: PlayedSong): Promise<void>;
    /** That history, newest first. */
    history(): Promise<HistoryEntry[]>;
    /** Adds time heard to a song's all-time listening. */
    listened(report: Listened): Promise<void>;
    /** Total listening and the top song, artist and album. */
    listening(): Promise<ListeningSummary>;
    /** Integrated loudness, measured once per file in Rust. */
    loudness(id: string): Promise<Loudness>;
    /** Shows a song's file in the system's file manager. */
    showInFolder(id: string): Promise<void>;
    /** Opens one of the library's folders in the file manager. */
    openFolder(path: string): Promise<void>;
    /** A file's format, size and date, for Show details. */
    fileInfo(id: string): Promise<FileInfo | null>;
  };
  lyrics: {
    /** A song's words from the enabled sources, or null when none has them. */
    get(song: LyricsQuery): Promise<FoundLyrics | null>;
  };
  spotify: {
    status(): Promise<SpotifyStatus>;
    signIn(): Promise<SpotifyStatus>;
    cancelSignIn(): Promise<void>;
    signOut(): Promise<SpotifyStatus>;
    playlists(): Promise<SpotifyPlaylist[]>;
    playlist(id: string, offset: number): Promise<SpotifyTrackPage>;
    /** The looping Canvas clip for a track, or null. */
    canvas(uri: string): Promise<string | null>;
    /** Drops cached playlists so the next read asks Spotify again. */
    refresh(): Promise<void>;
    /** Saved albums, newest first. */
    albums(): Promise<SpotifyAlbum[]>;
    /** Followed artists. */
    artists(): Promise<SpotifyArtist[]>;
    /** An album's rows, 50 at a time, matched to local files. */
    album(id: string, offset: number): Promise<SpotifyTrackPage>;
    /** Whether each of up to 40 URIs is in the library (the hearts). */
    saved(uris: string[]): Promise<boolean[]>;
    /** Saves or removes up to 40 URIs. */
    save(uris: string[], saved: boolean): Promise<void>;
    /** An artist page: profile, popular songs, releases, similar artists. */
    artist(id: string): Promise<SpotifyArtistPage>;
    /** Songs for a search, 20 a page; `next` continues. */
    search(query: string, offset: number): Promise<SpotifyTrackPage>;
    /** Home's rows: recent plays and this month's top songs and artists. */
    home(): Promise<SpotifyHome>;
    /** Older recent plays, from a page's cursor. */
    recentMore(before: number): Promise<SpotifyRecentPage>;
    /** One song's details. */
    song(id: string): Promise<SpotifySong>;
    /** Adds a playlist from its id, read from a pasted link. */
    importPlaylist(id: string): Promise<SpotifyPlaylist>;
    /** Takes an imported playlist off the list. */
    removeImport(id: string): Promise<void>;
  };
  youtube: {
    status(): Promise<YtStatus>;
    /** YouTube Music's home feed; `next` is the previous page's continuation. */
    home(next: string | null): Promise<YtHomePage>;
    explore(): Promise<YtExplore>;
    category(params: string): Promise<YtShelf[]>;
    /** Opens a song or page in YouTube Music in the browser. */
    open(videoId: string | null, browseId: string | null): Promise<void>;
    /** Saved playlists, albums and artists (signed in). */
    library(): Promise<YtLibrary>;
    /** An album (MPRE…) or playlist (VL…) page; `next` continues it. */
    page(browseId: string, next: string | null): Promise<YtPage>;
    /** Saves an album or playlist to the library, or removes it. */
    save(playlistId: string, saved: boolean): Promise<void>;
    /** An artist page (UC…). */
    artist(browseId: string): Promise<YtArtist>;
    /** The YouTube Music song that is the same recording, or null. */
    match(song: YtMatchQuery): Promise<YtMatch | null>;
    /** AutoPlay's next songs after this one (YouTube Music's radio). */
    radio(videoId: string): Promise<YtRadioSong[]>;
    /** YouTube Music's search, as shelves. */
    search(query: string): Promise<YtShelf[]>;
    /** Signing in through the default browser (Google's desktop-app OAuth). */
    oauth: {
      status(): Promise<YtOAuthStatus>;
      /** Your own Desktop-app OAuth client, stored encrypted in the main process. */
      configure(clientId: string, clientSecret: string): Promise<void>;
      signIn(): Promise<void>;
      cancel(): Promise<void>;
      signOut(): Promise<void>;
    };
    /** Playlists, liked videos and subscriptions of the browser-signed-in account. */
    googleAccount(): Promise<YtGoogleAccount>;
  };
  downloads: {
    state(): Promise<DownloadsState>;
    /** Queues up to 200 songs; ones already saved or owned are skipped. */
    add(
      songs: DownloadSong[],
      list: DownloadList | null,
    ): Promise<DownloadAddResult>;
    cancel(id: string): Promise<void>;
    cancelAll(): Promise<void>;
    /** Takes a finished or failed song off the list; its file stays. */
    remove(id: string): Promise<void>;
    /** Forgets finished and failed rows. */
    clear(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    retry(id: string): Promise<void>;
    retryFailed(): Promise<void>;
    moveToTop(id: string): Promise<void>;
    /** Moves a finished song's file to the Trash. */
    delete(id: string): Promise<void>;
    showInFolder(id: string): Promise<void>;
    /** The library track of a finished song, once a scan has read it. */
    locate(id: string): Promise<DownloadLocation | null>;
    chooseFolder(): Promise<ChooseDownloadFolderResult>;
    /** Every file wavebit saved that a scan has read, and the lists saved whole. */
    library(): Promise<DownloadedLibrary>;
    /** Opens the download folder in the file manager. */
    openFolder(): Promise<void>;
    /** Moves a downloaded song's file to the Trash, by its library track id. */
    deleteTrack(id: string): Promise<void>;
  };
  party: {
    state(): Promise<PartyState>;
    /** The account name and picture to join as; null when there is none. */
    setMe(me: PartyMe | null): Promise<void>;
    /** Starts a party and joins it as host. The outcome arrives as state. */
    create(autoplay: boolean): Promise<void>;
    /** Joins by code or pasted invite link. The outcome arrives as state. */
    join(text: string): Promise<void>;
    leave(): Promise<void>;
    control(control: PartyControl): Promise<void>;
    /** Says yes to the invite that is waiting. */
    acceptInvite(): Promise<void>;
    declineInvite(): Promise<void>;
    /** Asks the party server in Settings whether it answers. */
    probe(): Promise<PartyProbe>;
    /** Measures the clock again and asks the server where the party is. */
    resync(): Promise<void>;
  };
  /** Subscribes to a main-process event. Returns the unsubscribe function. */
  on<E extends keyof EventPayloads>(
    event: E,
    listener: (payload: EventPayloads[E]) => void,
  ): () => void;
}
