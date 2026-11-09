import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AlbumPage } from '../features/library/AlbumPage';
import { ArtistPage } from '../features/library/ArtistPage';
import { LibraryPage } from '../features/library/LibraryPage';
import {
  ExploreCategoryPage,
  ExplorePage,
} from '../features/explore/ExplorePage';
import { HomePage } from '../features/home/HomePage';
import { Onboarding } from '../features/onboarding/Onboarding';
import { player, type PlaybackOptions } from '../features/player/player';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PlaylistPage } from '../features/spotify/PlaylistPage';
import { SpotifyArtistPage } from '../features/spotify/SpotifyArtistPage';
import { SpotifySongPage } from '../features/spotify/SpotifySongPage';
import { SearchPage } from '../features/search/SearchPage';
import { YtArtistPage } from '../features/youtube/YtArtistPage';
import { YtPage } from '../features/youtube/YtPage';
import { AppShell } from '../layouts/AppShell';
import { useMainEvents, useSettings } from '../lib/queries';
import { useApplyTheme } from '../lib/useTheme';
import { useArtworkTheme } from '../features/player/useArtworkTheme';
import { useNav } from './router';

function Page() {
  const { route } = useNav();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'explore':
      return <ExplorePage />;
    case 'exploreCategory':
      return (
        <ExploreCategoryPage
          key={route.params}
          params={route.params}
          title={route.title}
        />
      );
    case 'library':
      return <LibraryPage tab={route.tab} />;
    case 'album':
      return <AlbumPage albumKey={route.key} />;
    case 'artist':
      return <ArtistPage name={route.artist} />;
    case 'playlist':
      return <PlaylistPage key={route.id} id={route.id} />;
    case 'spotifyAlbum':
      return <PlaylistPage key={route.id} id={route.id} album />;
    case 'spotifyArtist':
      return <SpotifyArtistPage key={route.id} id={route.id} />;
    case 'spotifySong':
      return <SpotifySongPage key={route.id} id={route.id} />;
    case 'ytPage':
      return <YtPage key={route.id} id={route.id} />;
    case 'search':
      return <SearchPage key={route.query} query={route.query} />;
    case 'ytArtist':
      return <YtArtistPage key={route.id} id={route.id} />;
    case 'settings':
      return <SettingsPage section={route.section} />;
  }
}

export function App() {
  const client = useQueryClient();
  const settings = useSettings().data;
  useMainEvents(client);
  useApplyTheme(settings);
  useArtworkTheme(settings);

  const remember = settings?.rememberQueue;
  useEffect(() => {
    if (remember !== undefined) player.restore(remember);
  }, [remember]);

  // Settings › Playback reaches the player whenever it changes.
  const playback: PlaybackOptions | null = settings
    ? {
        crossfade: settings.crossfade,
        normalize: settings.normalize,
        level: settings.loudnessLevel,
        speed: settings.playbackSpeed,
        skipSilence: settings.skipSilence,
        spatial: settings.spatialAudio,
        equalizer: settings.equalizerEnabled,
        bands: settings.equalizerBands,
        balance: settings.equalizerBalance,
        dontRepeat: settings.dontRepeatSongs,
        musicOnly: settings.preferMusicOnly,
      }
    : null;
  const playbackKey = JSON.stringify(playback);
  useEffect(() => {
    if (playback) player.configure(playback);
    // `playbackKey` stands for `playback`, a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackKey]);

  // Nothing renders until settings are read, so the theme never flashes.
  if (!settings) return null;
  if (settings.setupStep < 4) return <Onboarding settings={settings} />;
  return (
    <AppShell settings={settings}>
      <Page />
    </AppShell>
  );
}
