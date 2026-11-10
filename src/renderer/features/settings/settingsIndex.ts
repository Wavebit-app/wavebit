/** A section of Settings; `router.ts` has the same list as a route. */
type Section =
  | 'appearance'
  | 'spotify'
  | 'youtube'
  | 'library'
  | 'playback'
  | 'content'
  | 'downloads'
  | 'about';

export interface SettingEntry {
  id: string;
  section: Section;
  group: string;
  label: string;
  hint: string;
  /** Other words someone might search for, including rows that only matter once this is on. */
  keywords: string;
}

export const SECTION_TITLES: Record<Section, string> = {
  appearance: 'Appearance',
  spotify: 'Spotify',
  youtube: 'YouTube Music',
  library: 'Library',
  playback: 'Playback',
  content: 'Content preferences',
  downloads: 'Downloads',
  about: 'About',
};

type Row = [id: string, label: string, hint: string, keywords: string];

const group = (section: Section, name: string, rows: Row[]): SettingEntry[] =>
  rows.map(([id, label, hint, keywords]) => ({
    id,
    section,
    group: name,
    label,
    hint,
    keywords,
  }));

/** Every setting, and the one place its name and description are written. */
export const SETTINGS: SettingEntry[] = [
  ...group('appearance', 'Theme', [
    [
      'theme',
      'Theme',
      'System, Light, Dark, Pure Black, Midnight or Artwork.',
      'dark mode light mode system pure black oled amoled midnight navy artwork tinted colours',
    ],
  ]),
  ...group('appearance', 'Colour and text', [
    [
      'accent',
      'Accent',
      'Buttons, selection and the playing song.',
      'colour color tone blue violet green amber rose',
    ],
    [
      'textSize',
      'Text size',
      'Sizes every label, list and title together.',
      'font size bigger smaller zoom scale interface',
    ],
    [
      'font',
      'Font',
      'Inter is bundled; System uses your desktop font.',
      'typeface inter system',
    ],
  ]),
  ...group('appearance', 'Layout', [
    [
      'density',
      'Song rows',
      'List is 56 pixels tall, Compact 44. Also in the icon menu on song pages.',
      'density compact list row height',
    ],
  ]),
  ...group('appearance', 'Motion and effects', [
    [
      'motion',
      'Motion',
      'Your system setting can lower this further.',
      'animation reduce',
    ],
    [
      'reduceBlur',
      'Reduce blur',
      'Swaps blurred artwork for solid fills across the app.',
      'performance frosted solid transparency',
    ],
    [
      'moreContrast',
      'More contrast',
      'Darker secondary text and stronger outlines on fields and switches.',
      'accessibility readable',
    ],
  ]),
  ...group('appearance', 'Player', [
    [
      'playerTheme',
      'Player theme',
      'What sits behind the full-screen player.',
      'background mesh gradient blur colours',
    ],
    [
      'artworkBackdrop',
      'Show artwork behind pages',
      'A soft wash of the cover’s colours behind album pages and the full-screen player.',
      'backdrop blend tint cover',
    ],
    [
      'spotifyCanvas',
      'Spotify Canvas',
      'Spotify’s short looping clip behind the full-screen player, for songs played from a Spotify playlist.',
      'animated cover video loop',
    ],
    [
      'hideVolumeBar',
      'Hide volume bar',
      'Removes the volume slider from the player bar.',
      'slider controls',
    ],
    [
      'hidePlayingFrom',
      'Hide “Playing from”',
      'Removes the line above the song in the full-screen player.',
      'song status source played by',
    ],
    [
      'showQueueHistory',
      'Show queue history',
      'Shows up to 25 songs you played before, above Now playing in the queue.',
      'previously played up next',
    ],
  ]),
  ...group('appearance', 'Lyrics', [
    [
      'syncedLyrics',
      'Synced lyrics',
      'Lights up the words as they’re sung.',
      'lyrics timed karaoke follow',
    ],
    [
      'lyricsBlur',
      'Blur unfocused lyrics',
      'Keeps the spotlight on the current line.',
      'lyrics focus',
    ],
    [
      'lyricsSources',
      'Lyrics sources',
      'Which services are asked, and in what order.',
      'lyrics lrclib kugou betterlyrics unison lrc.red binilyrics lyricsplus portato youtube provider order',
    ],
  ]),
  ...group('downloads', 'Where songs go', [
    [
      'downloadFolder',
      'Download folder',
      'Where songs are saved. It joins your library.',
      'save location path music',
    ],
    [
      'downloadOrganise',
      'Organise into Artist and Album folders',
      'Off saves every song in one folder.',
      'subfolders layout tidy',
    ],
  ]),
  ...group('downloads', 'Downloading', [
    [
      'downloadConcurrency',
      'Songs at a time',
      'How many songs download together. Lower it on a slow connection.',
      'parallel speed simultaneous',
    ],
    [
      'downloadSkipOwned',
      'Skip songs already in my library',
      'Stops a second copy of a song you already have.',
      'duplicates',
    ],
  ]),
  ...group('downloads', 'What goes in the file', [
    [
      'downloadEmbedCover',
      'Embed cover art',
      'Saves the album picture inside each song.',
      'artwork tags',
    ],
    [
      'downloadEmbedLyrics',
      'Embed lyrics',
      'Saves the words inside each song, from LRCLIB.',
      'words tags',
    ],
  ]),
  ...group('downloads', 'Your library', [
    [
      'downloadSyncLists',
      'Keep downloaded playlists up to date',
      'Checks at launch and downloads songs added since.',
      'sync new songs automatic',
    ],
    [
      'downloadLibrary',
      'Download my whole library',
      'Every song in your Spotify and YouTube Music accounts. It tells you how long first.',
      'everything all offline',
    ],
  ]),
  ...group('playback', 'Transitions', [
    [
      'crossfade',
      'Crossfade',
      'The next song fades in while this one fades out.',
      'fade gapless blend',
    ],
  ]),
  ...group('playback', 'Volume', [
    [
      'normalize',
      'Volume normalisation',
      'Plays every song at a similar loudness. Each file is measured once, the first time it plays.',
      'loudness replaygain',
    ],
    [
      'loudnessLevel',
      'Volume level',
      'Quiet suits quiet rooms; Loud can flatten some dynamics.',
      'lufs loud quiet',
    ],
  ]),
  ...group('content', 'Music videos', [
    [
      'preferMusicOnly',
      'Prefer music-only version',
      'Music videos play as their song, when YouTube Music has it. Otherwise the video plays.',
      'video audio convert song',
    ],
    [
      'squareVideoThumbnails',
      'Square video thumbnails',
      'Shows music videos as squares in shelves. A playing video keeps its shape.',
      'artwork cover youtube',
    ],
  ]),
  ...group('content', 'Home and Explore', [
    [
      'hideRecentlyPlayed',
      'Hide Recently Played',
      'Removes the Recently Played shelf from Home.',
      'recents history feed shelf',
    ],
    [
      'hideHomeVideos',
      'Hide videos from Home',
      'Shelves of only videos go too. Search, artists and playlists still show them.',
      'music video youtube feed shelf',
    ],
    [
      'hideTopPicks',
      'Hide Top Picks for You',
      'Removes the tall cards at the top of Home.',
      'recommendations feed stations shelf',
    ],
    [
      'hideMoods',
      'Hide Find Your Mood',
      'Removes the moods and genres from Explore.',
      'mood moods genres feed explore',
    ],
  ]),
  ...group('playback', 'Sound', [
    [
      'equalizer',
      'Equalizer',
      'Presets, seven bands and left and right balance.',
      'eq bass treble tone preset balance',
    ],
    [
      'spatialAudio',
      'Spatial audio',
      'Widens stereo songs for a more immersive feel.',
      'surround 3d stereo wide',
    ],
  ]),
  ...group('playback', 'Speed and timing', [
    [
      'playbackSpeed',
      'Playback speed',
      'Faster or slower, keeping the pitch.',
      'tempo rate slow fast',
    ],
    [
      'skipSilence',
      'Skip silence',
      'Trims gaps longer than a second.',
      'gap quiet trim',
    ],
    [
      'sleepTimer',
      'Sleep timer',
      'Pauses the music after some minutes or at the end of this song.',
      'stop timer night minutes',
    ],
  ]),
  ...group('playback', 'Queue', [
    [
      'rememberQueue',
      'Remember the queue between launches',
      'wavebit reopens paused where you stopped.',
      'restore resume',
    ],
    [
      'closeToTray',
      'Keep running in the system tray when closed',
      'Closing the window leaves the music playing. Quit from the tray icon or File › Quit.',
      'background minimise',
    ],
    [
      'autoplay',
      'AutoPlay',
      'When the queue ends, keeps playing similar music.',
      'radio suggestions continue',
    ],
    [
      'dontRepeatSongs',
      'Don’t repeat songs',
      'AutoPlay won’t suggest a song already played or suggested since you opened wavebit.',
      'radio suggestions session duplicate',
    ],
  ]),
  ...group('library', 'Music folders', [
    [
      'musicFolders',
      'Music folders',
      'The folders wavebit reads your music from.',
      'add remove rescan scan files directory',
    ],
  ]),
  ...group('library', 'Watching', [
    [
      'watchFolders',
      'Watch these folders for new music',
      'New and changed files show up without a rescan.',
      'auto scan',
    ],
  ]),
  ...group('spotify', 'Account', [
    [
      'spotifyAccount',
      'Spotify account',
      'Connect, sign out and how the session is stored.',
      'sign in login connect keyring',
    ],
  ]),
  ...group('spotify', 'Library', [
    [
      'showPlaylists',
      'Show playlists in the sidebar',
      'Liked Songs first, then your own, followed and collaborative playlists.',
      'sidebar',
    ],
    [
      'refreshPlaylists',
      'Refresh playlists',
      'wavebit keeps your playlists for 10 minutes to spare Spotify’s rate limits.',
      'reload sync',
    ],
  ]),
  ...group('youtube', 'Account', [
    [
      'youtubeAccount',
      'YouTube Music account',
      'Sign in with your browser and your own Google OAuth client.',
      'google oauth sign in login',
    ],
  ]),
  ...group('youtube', 'What wavebit reads', [
    [
      'youtubeReads',
      'What wavebit reads',
      'Your playlists, liked videos and subscriptions, read-only.',
      'permissions privacy data api',
    ],
  ]),
  ...group('about', 'wavebit', [
    ['version', 'Version', 'Which wavebit this is.', 'update build'],
    [
      'github',
      'wavebit on GitHub',
      'The source code, issues and releases.',
      'repository repo source code open source issues',
    ],
    [
      'checkUpdates',
      'Check for updates',
      'See whether a newer wavebit is out.',
      'update upgrade new version release',
    ],
    [
      'autoUpdate',
      'Update automatically',
      'Downloads new versions in the background. wavebit only restarts when you press Restart to update.',
      'update upgrade background download automatic',
    ],
    [
      'whatsNew',
      "What's new",
      'What the installed version brought.',
      'update release notes changelog changes',
    ],
    [
      'runtime',
      'Runtime',
      'wavebit, native module and platform versions.',
      'version native platform',
    ],
    [
      'licences',
      'Licences',
      'Lucide, Inter, HeroUI, React and Electron.',
      'license open source credits',
    ],
  ]),
];

export const setting = (id: string): SettingEntry => {
  const found = SETTINGS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown setting: ${id}`);
  return found;
};

const RESULT_LIMIT = 12;

/**
 * Settings holding every word of the query, best first: names that start with
 * it, then names that contain it, then matches anywhere else.
 */
export function searchSettings(query: string): SettingEntry[] {
  const whole = query.trim().toLowerCase();
  const words = whole.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const rank = (entry: SettingEntry) => {
    const label = entry.label.toLowerCase();
    if (label.startsWith(whole)) return 0;
    return label.includes(words[0]!) ? 1 : 2;
  };
  return SETTINGS.filter((entry) => {
    const text =
      `${entry.label} ${entry.hint} ${entry.keywords} ${entry.group} ${SECTION_TITLES[entry.section]}`.toLowerCase();
    return words.every((word) => text.includes(word));
  })
    .map((entry) => ({ entry, score: rank(entry) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, RESULT_LIMIT)
    .map(({ entry }) => entry);
}
