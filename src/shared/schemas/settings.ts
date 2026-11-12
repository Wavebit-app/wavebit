import { z } from 'zod';
import { DEFAULT_LYRICS_ORDER } from '../lyricsSources.ts';

export const ThemeSchema = z.enum([
  'system',
  'light',
  'dark',
  'black',
  'midnight',
  'artwork',
]);
export const AccentSchema = z.enum([
  'blue',
  'violet',
  'green',
  'amber',
  'rose',
]);
export const MotionSchema = z.enum(['full', 'reduced', 'off']);
export const TextSizeSchema = z.enum(['small', 'default', 'large', 'larger']);
export const DensitySchema = z.enum(['comfortable', 'compact']);
export const FontSchema = z.enum(['inter', 'system']);
export const PlayerThemeSchema = z.enum(['blur', 'mesh']);
/** Crossfade length in seconds; BitChord offers the same five. */
export const CrossfadeSchema = z.union([
  z.literal(0),
  z.literal(3),
  z.literal(6),
  z.literal(9),
  z.literal(12),
]);
export const PlaybackSpeedSchema = z.union([
  z.literal(0.5),
  z.literal(0.75),
  z.literal(1),
  z.literal(1.25),
  z.literal(1.5),
  z.literal(2),
]);
/** Spotify's three normalisation levels: -23, -14 and -11 LUFS. */
export const LoudnessLevelSchema = z.enum(['quiet', 'normal', 'loud']);

/** Songs downloading at once. */
export const DownloadConcurrencySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

/** 0 is the welcome screen, 1–3 the setup steps, 4 means setup is finished. */
export const SetupStepSchema = z.number().int().min(0).max(4);

/** Display details only: the songs are read from Spotify each time. */
export const ImportedPlaylistSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9]{22}$/),
    name: z.string().min(1).max(300),
    owner: z.string().max(300).nullable(),
    imageUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    trackCount: z.number().int().min(0).nullable(),
  })
  .strict();

export const SettingsSchema = z
  .object({
    theme: ThemeSchema,
    accent: AccentSchema,
    textSize: TextSizeSchema,
    density: DensitySchema,
    font: FontSchema,
    motion: MotionSchema,
    moreContrast: z.boolean(),
    showPlaylists: z.boolean(),
    artworkBackdrop: z.boolean(),
    /** Blurred artwork gives way to solid fills. */
    reduceBlur: z.boolean(),
    playerTheme: PlayerThemeSchema,
    hideRecentlyPlayed: z.boolean(),
    hideTopPicks: z.boolean(),
    hideHomeVideos: z.boolean(),
    hideMoods: z.boolean(),
    /** A music video plays as its catalogue song when YouTube Music has one. */
    preferMusicOnly: z.boolean(),
    hideVolumeBar: z.boolean(),
    hidePlayingFrom: z.boolean(),
    squareVideoThumbnails: z.boolean(),
    showQueueHistory: z.boolean(),
    syncedLyrics: z.boolean(),
    lyricsBlur: z.boolean(),
    /** Plain strings, read through orderedSources: one retired id mustn't reset every setting. */
    lyricsSourceOrder: z.array(z.string().max(40)).max(40),
    lyricsSourcesOff: z.array(z.string().max(40)).max(40),
    sidebarCollapsed: z.boolean(),
    watchFolders: z.boolean(),
    rememberQueue: z.boolean(),
    /** Closing the window leaves wavebit playing in the system tray. */
    closeToTray: z.boolean(),
    /** Downloads new versions in the background; restarting is always asked for. */
    autoUpdate: z.boolean(),
    crossfade: CrossfadeSchema,
    normalize: z.boolean(),
    loudnessLevel: LoudnessLevelSchema,
    playbackSpeed: PlaybackSpeedSchema,
    skipSilence: z.boolean(),
    spatialAudio: z.boolean(),
    equalizerEnabled: z.boolean(),
    /** Decibels for each of the seven bands. */
    equalizerBands: z.array(z.number().min(-12).max(12)).length(7),
    /** -1 is all left, 1 all right. */
    equalizerBalance: z.number().min(-1).max(1),
    /** AutoPlay won't suggest a song already played or suggested this session. */
    dontRepeatSongs: z.boolean(),
    spotifyCanvas: z.boolean(),
    setupStep: SetupStepSchema,
    /** Only the main process adds folders, from the system folder picker. */
    libraryFolders: z.array(z.string().min(1).max(4096)).max(20),
    /** Null is Music/wavebit. Only the main process sets it, from the folder picker. */
    downloadFolder: z.string().min(1).max(4096).nullable(),
    downloadConcurrency: DownloadConcurrencySchema,
    downloadOrganise: z.boolean(),
    downloadEmbedCover: z.boolean(),
    downloadEmbedLyrics: z.boolean(),
    downloadSkipOwned: z.boolean(),
    downloadSyncLists: z.boolean(),
    /** Off hides Listen together everywhere, and the party server is never contacted. */
    partyEnabled: z.boolean(),
    /** A song picked in a party plays for everyone at once, or joins the party's queue. */
    partyPick: z.enum(['everyone', 'queue']),
    /** Plays this device earlier (above zero) or later than the party, for speakers that lag. */
    partyDelayMs: z.number().int().min(-500).max(500),
    /** An illustration behind the party's code in the drawer. */
    partyBanner: z.boolean(),
    /** Listen together: the name others see. Empty uses the account's name. */
    partyName: z.string().max(80),
    partyShareAvatar: z.boolean(),
    partyShowPing: z.boolean(),
    /** A short notice when someone joins or leaves. */
    partyNotices: z.boolean(),
    /** Empty is BitChord's server. Read through the Rust module, which only accepts an https origin. */
    partyServer: z.string().max(200),
    /** Spotify playlists added from a link. Only the main process writes these. */
    importedPlaylists: z.array(ImportedPlaylistSchema).max(200),
  })
  .strict();

export const THEME_NAMES: Record<z.infer<typeof ThemeSchema>, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  black: 'Pure Black',
  midnight: 'Midnight',
  artwork: 'Artwork',
};

/** What the renderer may change. Folders and imports have their own IPC. */
export const SettingsPatchSchema = SettingsSchema.omit({
  libraryFolders: true,
  downloadFolder: true,
  importedPlaylists: true,
})
  .partial()
  .strict();

export type Theme = z.infer<typeof ThemeSchema>;
export type PlayerTheme = z.infer<typeof PlayerThemeSchema>;
export type Accent = z.infer<typeof AccentSchema>;
export type Motion = z.infer<typeof MotionSchema>;
export type TextSize = z.infer<typeof TextSizeSchema>;
export type Crossfade = z.infer<typeof CrossfadeSchema>;
export type PlaybackSpeed = z.infer<typeof PlaybackSpeedSchema>;
export type DownloadConcurrency = z.infer<typeof DownloadConcurrencySchema>;
export type LoudnessLevel = z.infer<typeof LoudnessLevelSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'blue',
  textSize: 'default',
  density: 'comfortable',
  font: 'inter',
  motion: 'full',
  moreContrast: false,
  showPlaylists: true,
  artworkBackdrop: true,
  reduceBlur: false,
  playerTheme: 'blur',
  hideRecentlyPlayed: false,
  hideTopPicks: false,
  hideHomeVideos: false,
  hideMoods: false,
  preferMusicOnly: false,
  hideVolumeBar: false,
  hidePlayingFrom: false,
  squareVideoThumbnails: false,
  showQueueHistory: false,
  syncedLyrics: true,
  lyricsBlur: false,
  lyricsSourceOrder: [...DEFAULT_LYRICS_ORDER],
  lyricsSourcesOff: [],
  sidebarCollapsed: false,
  watchFolders: true,
  rememberQueue: true,
  closeToTray: true,
  autoUpdate: true,
  crossfade: 0,
  normalize: true,
  loudnessLevel: 'normal',
  playbackSpeed: 1,
  skipSilence: false,
  spatialAudio: false,
  equalizerEnabled: false,
  equalizerBands: [0, 0, 0, 0, 0, 0, 0],
  equalizerBalance: 0,
  dontRepeatSongs: false,
  spotifyCanvas: false,
  setupStep: 0,
  libraryFolders: [],
  downloadFolder: null,
  downloadConcurrency: 4,
  downloadOrganise: false,
  downloadEmbedCover: true,
  downloadEmbedLyrics: true,
  downloadSkipOwned: true,
  downloadSyncLists: false,
  partyEnabled: true,
  partyPick: 'everyone',
  partyDelayMs: 0,
  partyBanner: true,
  partyName: '',
  partyShareAvatar: true,
  partyShowPing: true,
  partyNotices: true,
  partyServer: '',
  importedPlaylists: [],
};
