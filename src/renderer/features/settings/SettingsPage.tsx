import { Alert, Avatar, Button, toast } from '@heroui/react';
import { KeyRound, LockKeyhole, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { enabledSources, sourceLabel } from '../../../shared/lyricsSources';
import type {
  Crossfade,
  PlaybackSpeed,
  SettingsPatch,
} from '../../../shared/schemas/settings';
import { nav, type SettingsSection } from '../../app/router';
import { setUi, useUi } from '../../app/ui';
import { GitHubMark, SpotifyMark } from '../../design/BrandMarks';
import { IconAction } from '../../design/IconAction';
import { Logo } from '../../design/Logo';
import { Segmented } from '../../design/Segmented';
import {
  useAppInfo,
  useRescan,
  useScanProgress,
  useSettings,
  useSpotifyActions,
  useSpotifyStatus,
  useUpdateSettings,
  useRefreshSpotify,
} from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { useMotion } from '../../lib/useTheme';
import { SETTINGS_SECTIONS } from '../../layouts/Sidebar';
import { FolderList } from '../library/FolderList';
import { ConnectSpotify } from '../spotify/ConnectSpotify';
import { DownloadsSection } from './DownloadsSection';
import { UpdatesSection } from './UpdatesSection';
import { presetFor } from '../player/audioEffects';
import { player, usePlayer } from '../player/player';
import { EqualizerSheet } from './EqualizerSheet';
import { YouTubeSection } from './YouTubeSection';
import { LyricsSourcesSheet } from './LyricsSourcesSheet';
import { AccentSwatches, ThemeCards } from './pickers';
import { RuntimeTable } from './RuntimeTable';
import { Group, LinkRow, Row, SettingSwitch } from './rows';
import { SettingsSearch } from './SettingsSearch';

function Appearance() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  const signedIn = useSpotifyStatus().data?.state === 'signed_in';
  const motionLimited = useMotion() !== 'full';
  const [sources, setSources] = useState(false);
  const set = (patch: SettingsPatch) => update.mutate(patch);
  const enabled = enabledSources(s.lyricsSourceOrder, s.lyricsSourcesOff);
  return (
    <>
      <Group title="Theme" anchor="theme" bare>
        <ThemeCards value={s.theme} onChange={(theme) => set({ theme })} />
      </Group>

      <Group title="Colour and text">
        <Row id="accent">
          <AccentSwatches
            value={s.accent}
            onChange={(accent) => set({ accent })}
          />
        </Row>
        <Row id="textSize">
          <Segmented
            label="Text size"
            value={s.textSize}
            onChange={(textSize) => set({ textSize })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
              { value: 'larger', label: 'Larger' },
            ]}
          />
        </Row>
        <Row id="font">
          <Segmented
            label="Font"
            value={s.font}
            onChange={(font) => set({ font })}
            options={[
              { value: 'inter', label: 'Inter' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Layout">
        <Row id="density">
          <Segmented
            label="Song rows"
            value={s.density}
            onChange={(density) => set({ density })}
            options={[
              { value: 'comfortable', label: 'List' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Motion and effects">
        <Row id="motion">
          <Segmented
            label="Motion"
            value={s.motion}
            onChange={(motion) => set({ motion })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
        <SettingSwitch
          id="reduceBlur"
          isSelected={s.reduceBlur}
          onChange={(reduceBlur) => set({ reduceBlur })}
        />
        <SettingSwitch
          id="moreContrast"
          isSelected={s.moreContrast}
          onChange={(moreContrast) => set({ moreContrast })}
        />
      </Group>
      <Group title="Player">
        <Row id="playerTheme">
          <Segmented
            label="Player theme"
            value={s.playerTheme}
            onChange={(playerTheme) => set({ playerTheme })}
            options={[
              { value: 'blur', label: 'Blur' },
              { value: 'mesh', label: 'Mesh' },
            ]}
          />
        </Row>
        <SettingSwitch
          id="artworkBackdrop"
          isSelected={s.artworkBackdrop}
          onChange={(artworkBackdrop) => set({ artworkBackdrop })}
        />
        <SettingSwitch
          id="spotifyCanvas"
          description={
            motionLimited
              ? 'Off while Motion is Reduced or Off, or your system asks for less motion.'
              : !signedIn
                ? 'Connect Spotify to use this.'
                : undefined
          }
          isSelected={s.spotifyCanvas && !motionLimited}
          isDisabled={motionLimited || !signedIn}
          onChange={(spotifyCanvas) => set({ spotifyCanvas })}
        />
        <SettingSwitch
          id="hideVolumeBar"
          isSelected={s.hideVolumeBar}
          onChange={(hideVolumeBar) => set({ hideVolumeBar })}
        />
        <SettingSwitch
          id="hidePlayingFrom"
          isSelected={s.hidePlayingFrom}
          onChange={(hidePlayingFrom) => set({ hidePlayingFrom })}
        />
        <SettingSwitch
          id="showQueueHistory"
          isSelected={s.showQueueHistory}
          onChange={(showQueueHistory) => set({ showQueueHistory })}
        />
      </Group>
      <Group title="Lyrics">
        <SettingSwitch
          id="syncedLyrics"
          isSelected={s.syncedLyrics}
          onChange={(syncedLyrics) => set({ syncedLyrics })}
        />
        <SettingSwitch
          id="lyricsBlur"
          description={
            !s.syncedLyrics
              ? 'Needs Synced lyrics to be on.'
              : s.reduceBlur
                ? 'Off while Reduce blur is on.'
                : undefined
          }
          isSelected={s.lyricsBlur && s.syncedLyrics && !s.reduceBlur}
          isDisabled={!s.syncedLyrics || s.reduceBlur}
          onChange={(lyricsBlur) => set({ lyricsBlur })}
        />
        <LinkRow
          id="lyricsSources"
          hint={
            enabled.map(sourceLabel).join(', ') ||
            'None. Lyrics will not be fetched.'
          }
          onPress={() => setSources(true)}
        />
        <LyricsSourcesSheet isOpen={sources} onOpenChange={setSources} />
      </Group>
    </>
  );
}

function SpotifySection() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  const status = useSpotifyStatus().data;
  const { signOut } = useSpotifyActions();
  const refresh = useRefreshSpotify();
  const signedIn = status?.state === 'signed_in';
  const storage =
    status?.storage === 'session'
      ? 'Kept until wavebit quits, because this desktop has no keyring to encrypt it with.'
      : 'Encrypted with your system keyring.';
  return (
    <>
      <Group title="Account" anchor="spotifyAccount">
        <div className="px-4 pt-1 pb-4">
          {signedIn ? (
            <div className="mt-3 flex items-center gap-3.5">
              <Avatar className="size-10">
                {status.profile?.imageUrl && (
                  <Avatar.Image src={status.profile.imageUrl} alt="" />
                )}
                <Avatar.Fallback>
                  <SpotifyMark size={40} />
                </Avatar.Fallback>
              </Avatar>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">
                  {status.profile
                    ? `Signed in as ${status.profile.name}`
                    : 'Connected'}
                </span>
                <span className="text-sm text-muted">{storage}</span>
              </span>
              <Button
                variant="danger-soft"
                isPending={signOut.isPending}
                onPress={() =>
                  signOut.mutate(undefined, {
                    onSuccess: () => toast('Signed out of Spotify'),
                  })
                }
              >
                Sign out
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex max-w-sm flex-col gap-3">
              <p className="text-muted">
                Not connected. Connect to see your playlists and Liked Songs.
              </p>
              <ConnectSpotify />
            </div>
          )}
          {status?.storage === 'session' && (
            <Alert status="warning" className="mt-5">
              <Alert.Indicator>
                <KeyRound size={18} />
              </Alert.Indicator>
              <Alert.Content>
                <Alert.Title>No keyring on this desktop</Alert.Title>
                <Alert.Description>
                  wavebit keeps the Spotify session in memory only and asks you
                  to connect again after each restart.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </div>
      </Group>

      <Group
        title="Library"
        footer="Each Spotify song plays from your own file when wavebit finds the same recording: the same title and version, a shared artist, and a length within 30 seconds."
      >
        <SettingSwitch
          id="showPlaylists"
          isSelected={s.showPlaylists}
          onChange={(showPlaylists) => update.mutate({ showPlaylists })}
        />
        <Row id="refreshPlaylists">
          <Button
            variant="secondary"
            isDisabled={!signedIn}
            isPending={refresh.isPending}
            onPress={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast('Playlists refreshed'),
              })
            }
          >
            <RefreshCw size={16} aria-hidden />
            Refresh
          </Button>
        </Row>
      </Group>

      <p className="mt-6 flex items-start gap-2 text-sm leading-normal text-muted">
        <LockKeyhole size={16} className="mt-0.5 shrink-0" aria-hidden />
        Spotify has no way for apps to revoke a session. Signing out deletes it
        from this computer; to end it everywhere, use Sign out everywhere on
        spotify.com.
      </p>
    </>
  );
}

function LibrarySection() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  const rescan = useRescan();
  const progress = useScanProgress();
  return (
    <>
      <Group title="Music folders" anchor="musicFolders">
        <div className="px-4 py-3">
          <FolderList />
          <Button
            variant="secondary"
            className="mt-4"
            isPending={rescan.isPending || progress.running}
            onPress={() => rescan.mutate()}
          >
            Rescan now
          </Button>
        </div>
      </Group>
      <Group title="Watching">
        <SettingSwitch
          id="watchFolders"
          isSelected={s.watchFolders}
          onChange={(watchFolders) => update.mutate({ watchFolders })}
        />
      </Group>
    </>
  );
}

const CONTENT_SWITCHES = {
  'Music videos': ['preferMusicOnly', 'squareVideoThumbnails'],
  'Home and Explore': [
    'hideRecentlyPlayed',
    'hideHomeVideos',
    'hideTopPicks',
    'hideMoods',
  ],
} as const;

/** BitChord's Content Preferences: what shows up, and how music videos play. */
function ContentSection() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  return (
    <>
      {Object.entries(CONTENT_SWITCHES).map(([heading, ids]) => (
        <Group key={heading} title={heading}>
          {ids.map((id) => (
            <SettingSwitch
              key={id}
              id={id}
              isSelected={s[id]}
              onChange={(value) => update.mutate({ [id]: value })}
            />
          ))}
        </Group>
      ))}
    </>
  );
}

const SPEEDS: PlaybackSpeed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

function Playback() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  const autoplay = usePlayer((p) => p.autoplay);
  const sleep = usePlayer((p) => p.sleep);
  const sleepAt = usePlayer((p) => p.sleepAt);
  const [equalizer, setEqualizer] = useState(false);
  const trayMissing = useAppInfo().data?.trayAvailable === false;
  const preset = presetFor(s.equalizerBands);
  return (
    <>
      <Group title="Transitions">
        <Row id="crossfade">
          <Segmented
            label="Crossfade"
            value={String(s.crossfade) as `${Crossfade}`}
            onChange={(v) =>
              update.mutate({ crossfade: Number(v) as Crossfade })
            }
            options={[
              { value: '0', label: 'Off' },
              { value: '3', label: '3 s' },
              { value: '6', label: '6 s' },
              { value: '9', label: '9 s' },
              { value: '12', label: '12 s' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Volume">
        <SettingSwitch
          id="normalize"
          isSelected={s.normalize}
          onChange={(normalize) => update.mutate({ normalize })}
        />
        <Row id="loudnessLevel">
          <Segmented
            label="Volume level"
            value={s.loudnessLevel}
            onChange={(loudnessLevel) =>
              s.normalize && update.mutate({ loudnessLevel })
            }
            options={[
              { value: 'quiet', label: 'Quiet' },
              { value: 'normal', label: 'Normal' },
              { value: 'loud', label: 'Loud' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Sound">
        <LinkRow
          id="equalizer"
          hint={s.equalizerEnabled ? (preset?.name ?? 'Custom') : 'Off'}
          onPress={() => setEqualizer(true)}
        />
        <SettingSwitch
          id="spatialAudio"
          isSelected={s.spatialAudio}
          onChange={(spatialAudio) => update.mutate({ spatialAudio })}
        />
        <EqualizerSheet isOpen={equalizer} onOpenChange={setEqualizer} />
      </Group>
      <Group
        title="Speed and timing"
        footer="The equalizer, spatial audio and skip silence work on your own music files. YouTube Music songs play in YouTube’s own player, where wavebit can only change the speed."
      >
        <Row id="playbackSpeed">
          <Segmented
            label="Playback speed"
            value={String(s.playbackSpeed)}
            onChange={(v) =>
              update.mutate({ playbackSpeed: Number(v) as PlaybackSpeed })
            }
            options={SPEEDS.map((speed) => ({
              value: String(speed),
              label: `${speed}×`,
            }))}
          />
        </Row>
        <SettingSwitch
          id="skipSilence"
          isSelected={s.skipSilence}
          onChange={(skipSilence) => update.mutate({ skipSilence })}
        />
        <Row
          id="sleepTimer"
          hint={
            sleepAt
              ? `Pauses at ${new Date(sleepAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
              : sleep === 'song'
                ? 'Pauses when this song ends.'
                : undefined
          }
        >
          <Segmented
            label="Sleep timer"
            value={sleep}
            onChange={(choice) => player.setSleep(choice)}
            options={[
              { value: 'off', label: 'Off' },
              { value: '15', label: '15' },
              { value: '30', label: '30' },
              { value: '45', label: '45' },
              { value: '60', label: '60' },
              { value: 'song', label: 'Song end' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Queue">
        <SettingSwitch
          id="rememberQueue"
          isSelected={s.rememberQueue}
          onChange={(rememberQueue) => update.mutate({ rememberQueue })}
        />
        <SettingSwitch
          id="closeToTray"
          description={
            trayMissing
              ? 'This desktop has no system tray, so closing the window quits wavebit.'
              : undefined
          }
          isDisabled={trayMissing}
          isSelected={s.closeToTray}
          onChange={(closeToTray) => update.mutate({ closeToTray })}
        />
        <SettingSwitch
          id="autoplay"
          isSelected={autoplay}
          onChange={() => player.toggleAutoplay()}
        />
        <SettingSwitch
          id="dontRepeatSongs"
          description={
            autoplay ? undefined : 'Only applies while AutoPlay is on.'
          }
          isSelected={s.dontRepeatSongs}
          isDisabled={!autoplay}
          onChange={(dontRepeatSongs) => update.mutate({ dontRepeatSongs })}
        />
      </Group>
    </>
  );
}

function About() {
  const info = useAppInfo().data;
  return (
    <>
      <div
        data-setting="version"
        className="mt-6 flex items-center gap-4 rounded-md"
      >
        <Logo size={72} />
        <span className="flex flex-col">
          <span className="text-xl font-semibold">wavebit</span>
          <span className="text-sm text-muted tabular-nums">
            Version {info?.version}
          </span>
        </span>
        <span data-setting="github" className="ml-auto">
          <IconAction
            label="View wavebit on GitHub"
            onPress={() => void window.wavebit.updates.open('repo')}
          >
            <GitHubMark size={24} />
          </IconAction>
        </span>
      </div>
      <UpdatesSection />
      <Group title="Runtime" anchor="runtime">
        <div className="p-4">{info && <RuntimeTable info={info} />}</div>
      </Group>
      <Group title="Licences" anchor="licences">
        <p className="p-4 text-sm leading-relaxed text-muted">
          wavebit is free software under the GPLv3. Icons and the logo mark:
          Lucide (ISC). Inter (SIL Open Font Licence). HeroUI, React and
          Electron (MIT). Not affiliated with Spotify.
        </p>
      </Group>
    </>
  );
}

/** How long a setting found by search stays tinted. */
const FLASH_MS = 1600;

/** DESIGN.md › Settings: one section at a time, centred in the workspace. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const size = useSizeClass();
  const collapsed = useSettings().data?.sidebarCollapsed ?? false;
  const compact = size === 'compact';
  const motion = useMotion();
  const focus = useUi((s) => s.settingsFocus);
  const meta = SETTINGS_SECTIONS.find((s) => s.id === section)!;
  const hints: Record<SettingsSection, string> = {
    appearance: 'Every change applies straight away.',
    spotify: 'Your Spotify connection and what wavebit reads from it.',
    youtube: 'Sign in to YouTube through your browser.',
    library: 'Where wavebit finds your music.',
    playback: 'How songs play.',
    content: 'What shows up, and how music videos play.',
    downloads: 'Where songs are saved and what goes in them.',
    about: 'The version and what wavebit is built with.',
  };

  // A search result: bring the setting into view and tint it for a moment.
  useEffect(() => {
    if (!focus) return;
    const row = document.querySelector(`[data-setting="${focus}"]`);
    if (!row) return;
    row.scrollIntoView({
      block: 'center',
      behavior: motion === 'full' ? 'smooth' : 'auto',
    });
    row.setAttribute('data-flash', '');
    const done = setTimeout(() => {
      row.removeAttribute('data-flash');
      setUi({ settingsFocus: null });
    }, FLASH_MS);
    return () => {
      clearTimeout(done);
      row.removeAttribute('data-flash');
    };
  }, [focus, section, motion]);

  const content = (
    <>
      <h1 className="text-page font-semibold tracking-[-0.01em]">
        {meta.label}
      </h1>
      <span className="mt-1 text-sm text-muted">{hints[section]}</span>
      {section === 'appearance' && <Appearance />}
      {section === 'spotify' && <SpotifySection />}
      {section === 'youtube' && <YouTubeSection />}
      {section === 'library' && <LibrarySection />}
      {section === 'playback' && <Playback />}
      {section === 'content' && <ContentSection />}
      {section === 'downloads' && <DownloadsSection />}
      {section === 'about' && <About />}
    </>
  );
  return (
    <div className={compact ? 'p-5' : 'px-10 py-8'}>
      <div className="mx-auto flex max-w-[720px] flex-col">
        {compact && (
          <div className="-mx-5 mb-4 overflow-x-auto px-5">
            <Segmented
              label="Settings section"
              value={section}
              onChange={(next) => nav.go({ name: 'settings', section: next })}
              options={SETTINGS_SECTIONS.map((s) => ({
                value: s.id,
                label: s.label,
              }))}
            />
          </div>
        )}
        {/* The rail and the tab bar have no room for the field, so it sits on the page. */}
        {compact || size === 'medium' || collapsed ? (
          <SettingsSearch onPage>
            <div className="mt-6 flex flex-col">{content}</div>
          </SettingsSearch>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
