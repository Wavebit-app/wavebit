import { Alert, Button, Kbd, Link } from '@heroui/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { errorCode } from '../../../shared/errors';
import type { Settings, SettingsPatch } from '../../../shared/schemas/settings';
import { nav } from '../../app/router';
import { Banner } from '../../design/Banner';
import { SpotifyMark, YouTubeMusicMark } from '../../design/BrandMarks';
import { IconAction } from '../../design/IconAction';
import { IconTile } from '../../design/IconTile';
import { Segmented } from '../../design/Segmented';
import { SideOrBottomSheet } from '../../design/Sheet';
import { SwitchRow } from '../../design/SwitchRow';
import {
  useLibraryState,
  useSpotifyActions,
  useSpotifyStatus,
  useUpdateSettings,
  useYtOAuth,
  useYtOAuthActions,
} from '../../lib/queries';
import { BREAKPOINTS, useWindowWidth } from '../../lib/useBreakpoint';
import { useResolvedTheme } from '../../lib/useTheme';
import { TitleBar } from '../../layouts/TitleBar';
import { FolderList } from '../library/FolderList';
import { AccentSwatches, ThemeCards } from '../settings/pickers';
import {
  googleSignInError,
  SetUp as YouTubeClient,
} from '../settings/YouTubeSection';
import type { ErrorCode } from '../../../shared/schemas/spotify';
import { SPOTIFY_ERRORS, WhatWavebitSees } from '../spotify/ConnectSpotify';
import { AccountsArt, FoldersArt, ThemesArt, WelcomeArt } from './BannerArt';

/** Each screen's banner, in the README's words (README.md › Features). */
const BANNERS = [
  {
    title: 'All your music.',
    highlight: 'One player.',
    line: 'Your files, Spotify and YouTube Music. Free and open source.',
  },
  {
    title: 'Your own files.',
    highlight: 'Always in sync.',
    line: 'Scanned from your music folders and watched for changes.',
  },
  {
    title: 'Side by side.',
    highlight: 'All in one place.',
    line: 'Your files, your Spotify library and YouTube Music, side by side.',
  },
  {
    title: 'Your colours.',
    highlight: 'Your player.',
    line: 'Artwork themes that take their colours from the cover, plus Light, Dark, Black and Midnight.',
  },
];

/**
 * Welcome and setup share one split: the banner fills the whole left side,
 * top to bottom, and the column sits on the right. Narrow windows put a
 * strip of the banner above the column.
 */
function Split({
  step,
  art,
  children,
}: {
  step: number;
  art: ReactNode;
  children: ReactNode;
}) {
  const wide = useWindowWidth() >= BREAKPOINTS.split;
  const banner = (
    <Banner
      id={String(step)}
      {...BANNERS[step]!}
      art={art}
      compact={!wide}
      flush={step === 0}
      centered={step === 0}
    />
  );
  return (
    <div className="flex h-full flex-col bg-canvas text-foreground">
      <TitleBar minimal />
      <main
        className={`flex min-h-0 flex-1 overflow-hidden rounded-tl-md bg-surface ${wide ? 'flex-row' : 'flex-col overflow-y-auto'}`}
      >
        {wide ? (
          <div className="flex min-w-0 flex-[48_1_0]">{banner}</div>
        ) : (
          <div className="px-4 pt-4">{banner}</div>
        )}
        <div
          className={`flex min-w-0 justify-center ${wide ? 'flex-[52_1_0] overflow-y-auto px-10 py-12' : 'flex-1 px-6 pt-6 pb-[calc(34px+env(safe-area-inset-bottom,0px)+env(keyboard-inset-height,0px))]'}`}
        >
          <div className="my-auto flex w-full max-w-[440px] flex-col">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

function Welcome({ go, skip }: { go: () => void; skip: () => void }) {
  const wide = useWindowWidth() >= BREAKPOINTS.split;
  return (
    <Split step={0} art={<WelcomeArt />}>
      <h1 className="text-hero font-semibold tracking-[-0.02em]">
        Welcome to wavebit
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Your music files, your Spotify library and YouTube Music, in one quiet
        player.
      </p>
      <div
        className={`mt-9 flex gap-3 ${wide ? 'flex-row items-center' : 'flex-col'}`}
      >
        <Button size="lg" className="h-12 rounded-full px-6" onPress={go}>
          Get started
          <ArrowRight size={18} aria-hidden />
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="h-12 rounded-full"
          onPress={skip}
        >
          Skip setup
        </Button>
      </div>
      <p className="mt-7 text-sm leading-normal text-muted">
        Takes about a minute. You can change everything later in Settings.
      </p>
    </Split>
  );
}

/** Three 6px segments and "Step 2 of 3", at the top of the column. */
function Progress({ step }: { step: number }) {
  return (
    <>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        className="grid grid-cols-3 gap-1.5"
      >
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`h-1.5 rounded-full ${n <= step ? 'bg-accent' : 'bg-sunken'}`}
          />
        ))}
      </div>
      <span className="mt-4 text-[0.8667rem] font-medium text-muted">
        Step {step} of 3
      </span>
    </>
  );
}

/** Back as a large icon, then Skip for now (text) and the step's one pill. */
function Footer({
  back,
  skip,
  next,
  nextLabel,
  nextDisabled,
}: {
  back: () => void;
  skip?: () => void;
  next?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-9 flex items-center gap-2">
      <IconAction label="Back" size={48} onPress={back}>
        <ArrowLeft size={24} aria-hidden />
      </IconAction>
      <span className="flex-1" />
      {skip && (
        <Button
          variant="ghost"
          size="lg"
          className="h-12 rounded-full"
          onPress={skip}
        >
          Skip for now
        </Button>
      )}
      {next && (
        <Button
          size="lg"
          className="h-12 rounded-full px-6"
          onPress={next}
          isDisabled={nextDisabled}
        >
          {nextLabel ?? 'Continue'}
          <ArrowRight size={18} aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** Step 2: Spotify and YouTube Music as two large icons, each with its own state. */
function Accounts({ back, next }: { back: () => void; next: () => void }) {
  const spotify = useSpotifyStatus().data;
  const { signIn, cancel } = useSpotifyActions();
  const youtube = useYtOAuth().data;
  const yt = useYtOAuthActions();
  const [spError, setSpError] = useState<ErrorCode | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [seeSheet, setSeeSheet] = useState(false);
  const [clientSheet, setClientSheet] = useState(false);
  const spotifyIn = spotify?.state === 'signed_in';
  const youtubeIn = !!youtube?.signedIn;

  // Escape backs out of Spotify's sign-in window, as in Settings.
  useEffect(() => {
    if (!signIn.isPending) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signIn.isPending, cancel]);

  const connectSpotify = () => {
    if (spotifyIn) return;
    setSpError(null);
    signIn.mutate(undefined, {
      onError: (e) => {
        const code = (errorCode(e) ?? 'network') as ErrorCode;
        // Closing the window or backing out was the listener's own choice.
        if (code !== 'cancelled' && code !== 'closed') setSpError(code);
      },
    });
  };

  const signInYouTube = () => {
    setYtError(null);
    yt.signIn.mutate(undefined, {
      onError: (e) => setYtError(googleSignInError(e)),
    });
  };
  const connectYouTube = () => {
    if (youtubeIn || yt.signIn.isPending) return;
    if (youtube?.configured) signInYouTube();
    else setClientSheet(true);
  };

  // Once the OAuth client is saved, the sheet closes and sign-in starts.
  const configured = !!youtube?.configured;
  useEffect(() => {
    if (clientSheet && configured) {
      setClientSheet(false);
      signInYouTube();
    }
    // signInYouTube is rebuilt each render; only the saved client matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSheet, configured]);

  const spMessage = spError && SPOTIFY_ERRORS[spError];
  const any = spotifyIn || youtubeIn;

  return (
    <>
      <Progress step={2} />
      <h1 className="mt-2 text-step font-semibold tracking-[-0.02em]">
        Connect your accounts
      </h1>
      <p className="mt-3 leading-relaxed text-muted">
        Both are optional. wavebit reads your playlists and library, and never
        posts, follows or changes anything.
      </p>
      <div className="mt-7 flex flex-wrap items-start gap-3">
        <IconTile
          large
          label="Spotify"
          icon={<SpotifyMark size={48} />}
          isPending={signIn.isPending}
          done={spotifyIn}
          tone={spotifyIn ? 'success' : spMessage ? 'danger' : 'muted'}
          status={
            spotifyIn
              ? `Connected${spotify?.profile ? ` as ${spotify.profile.name}` : ''}`
              : signIn.isPending
                ? 'Finish in the Spotify window'
                : spMessage
                  ? 'Try again'
                  : 'Playlists and Liked Songs'
          }
          onPress={connectSpotify}
        />
        <IconTile
          large
          label="YouTube Music"
          icon={<YouTubeMusicMark size={48} />}
          isPending={yt.signIn.isPending}
          done={youtubeIn}
          tone={youtubeIn ? 'success' : ytError ? 'danger' : 'muted'}
          status={
            youtubeIn
              ? 'Connected'
              : yt.signIn.isPending
                ? 'Finish in your browser'
                : ytError
                  ? 'Try again'
                  : 'Your home, library and playlists'
          }
          onPress={connectYouTube}
        />
      </div>
      {signIn.isPending && (
        <div className="mt-4 flex flex-col gap-2.5">
          <p className="text-sm leading-normal text-muted">
            Finish signing in in the Spotify window. It shows{' '}
            <span className="font-medium text-foreground">
              accounts.spotify.com
            </span>{' '}
            in its title.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onPress={cancel}
            >
              Cancel
            </Button>
            <span className="flex items-center gap-1.5 text-[0.8667rem] text-muted">
              or press <Kbd>Esc</Kbd>
            </span>
          </div>
        </div>
      )}
      {yt.signIn.isPending && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-muted">
            Your browser opened Google’s sign-in page.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onPress={yt.cancel}
          >
            Cancel
          </Button>
        </div>
      )}
      {(spMessage || ytError) && !signIn.isPending && (
        <Alert status="danger" role="alert" className="mt-4">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{spMessage ? spMessage.title : ytError}</Alert.Title>
            {spMessage && (
              <Alert.Description>{spMessage.body}</Alert.Description>
            )}
          </Alert.Content>
        </Alert>
      )}
      <p className="mt-5 text-sm leading-normal text-muted">
        wavebit never sees your passwords.{' '}
        <Link
          onPress={() => setSeeSheet(true)}
          className="cursor-pointer font-medium text-accent"
        >
          What wavebit can see
        </Link>
      </p>
      <WhatWavebitSees isOpen={seeSheet} onOpenChange={setSeeSheet} />
      <SideOrBottomSheet
        isOpen={clientSheet}
        onOpenChange={setClientSheet}
        title="Connect YouTube Music"
      >
        <div className="pb-6">
          <YouTubeClient />
        </div>
      </SideOrBottomSheet>
      <Footer
        back={back}
        skip={any ? undefined : next}
        next={any ? next : undefined}
      />
    </>
  );
}

/** DESIGN.md › Welcome and setup. Setup never blocks the app; every step can be skipped. */
export function Onboarding({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const set = (patch: SettingsPatch) => update.mutate(patch);
  const step = settings.setupStep;
  const setStep = (setupStep: number) => set({ setupStep });
  const library = useLibraryState().data;
  const spotify = useSpotifyStatus().data;
  const youtube = useYtOAuth().data;
  const theme = useResolvedTheme(settings);
  const finish = () => {
    nav.go(
      spotify?.state === 'signed_in'
        ? { name: 'home' }
        : { name: 'library', tab: 'songs' },
    );
    set({ setupStep: 4 });
  };

  if (step === 0) return <Welcome go={() => setStep(1)} skip={finish} />;

  const art =
    step === 1 ? (
      <FoldersArt
        folders={library?.folders ?? []}
        songs={library?.trackCount ?? 0}
      />
    ) : step === 2 ? (
      <AccountsArt
        spotify={spotify?.state === 'signed_in'}
        youtube={!!youtube?.signedIn}
      />
    ) : (
      <ThemesArt theme={settings.theme === 'system' ? theme : settings.theme} />
    );

  return (
    <Split step={step} art={art}>
      {step === 1 && (
        <>
          <Progress step={1} />
          <h1 className="mt-2 text-step font-semibold tracking-[-0.02em]">
            Add your music
          </h1>
          <p className="mt-3 leading-relaxed text-muted">
            Choose the folders that hold your music files. wavebit reads them
            where they are and never moves or changes them.
          </p>
          <div className="mt-7">
            <FolderList pill tile />
          </div>
          <div className="mt-6">
            <SwitchRow
              label="Watch these folders for new music"
              description="New files show up without a rescan."
              isSelected={settings.watchFolders}
              onChange={(watchFolders) => set({ watchFolders })}
            />
          </div>
          <Footer
            back={() => setStep(0)}
            skip={() => setStep(2)}
            next={() => setStep(2)}
            nextDisabled={!library?.folders.length}
          />
        </>
      )}
      {step === 2 && (
        <Accounts back={() => setStep(1)} next={() => setStep(3)} />
      )}
      {step === 3 && (
        <>
          <Progress step={3} />
          <h1 className="mt-2 text-step font-semibold tracking-[-0.02em]">
            Make it yours
          </h1>
          <p className="mt-3 leading-relaxed text-muted">
            Each choice applies as you pick it. All of them are in Settings ›
            Appearance later.
          </p>
          <h2 className="mt-7 mb-2.5 font-semibold">Theme</h2>
          <ThemeCards
            value={settings.theme}
            onChange={(theme) => set({ theme })}
            height={64}
            themes={['system', 'light', 'dark']}
          />
          <h2 className="mt-6 mb-2.5 font-semibold">Accent</h2>
          <AccentSwatches
            value={settings.accent}
            onChange={(accent) => set({ accent })}
          />
          <h2 className="mt-6 mb-2.5 font-semibold">Text size</h2>
          <Segmented
            label="Text size"
            value={settings.textSize}
            onChange={(textSize) => set({ textSize })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
              { value: 'larger', label: 'Larger' },
            ]}
          />
          <Footer
            back={() => setStep(2)}
            next={finish}
            nextLabel="Start listening"
          />
        </>
      )}
    </Split>
  );
}
