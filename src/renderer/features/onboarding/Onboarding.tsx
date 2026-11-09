import { Button, Link } from '@heroui/react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { Settings, SettingsPatch } from '../../../shared/schemas/settings';
import { nav } from '../../app/router';
import { Logo } from '../../design/Logo';
import { Segmented } from '../../design/Segmented';
import { SwitchRow } from '../../design/SwitchRow';
import { count } from '../../lib/format';
import {
  useLibraryState,
  useSpotifyStatus,
  useUpdateSettings,
} from '../../lib/queries';
import { BREAKPOINTS, useWindowWidth } from '../../lib/useBreakpoint';
import { useMotion } from '../../lib/useTheme';
import { TitleBar } from '../../layouts/TitleBar';
import { FolderList } from '../library/FolderList';
import { AccentSwatches, ThemeCards } from '../settings/pickers';
import { ConnectSpotify, WhatWavebitSees } from '../spotify/ConnectSpotify';

const STEPS = [
  { name: 'Add your music', hint: 'Folders with your music files' },
  { name: 'Connect Spotify', hint: 'Optional · your playlists' },
  { name: 'Make it yours', hint: 'Theme, accent and text size' },
];

/** Welcome and setup share one split: something on the left, the column on the right. */
function Split({
  left,
  children,
  wide,
}: {
  left: ReactNode;
  children: ReactNode;
  wide: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas text-foreground">
      <TitleBar minimal />
      <main
        className={`flex min-h-0 flex-1 overflow-y-auto rounded-tl-md bg-surface ${wide ? 'flex-row' : 'flex-col'}`}
      >
        <div
          className={
            wide
              ? 'flex flex-[44_1_0] items-center justify-center p-12'
              : 'px-6 pt-4'
          }
        >
          {left}
        </div>
        <div
          className={`flex items-center justify-center ${wide ? 'flex-[56_1_0] px-10 py-12' : 'flex-1 px-6 pt-6 pb-[calc(34px+env(safe-area-inset-bottom,0px)+env(keyboard-inset-height,0px))]'}`}
        >
          <div className="flex w-full max-w-[440px] flex-col">{children}</div>
        </div>
      </main>
    </div>
  );
}

function Welcome({ go, skip }: { go: () => void; skip: () => void }) {
  const wide = useWindowWidth() >= BREAKPOINTS.split;
  const motionLevel = useMotion();
  return (
    <div className="flex h-full flex-col bg-canvas text-foreground">
      <TitleBar minimal />
      <main
        className={`flex min-h-0 flex-1 overflow-y-auto rounded-tl-md bg-surface ${wide ? 'flex-row' : 'flex-col'}`}
      >
        <motion.div
          initial={motionLevel === 'off' ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className={`flex items-center justify-center ${wide ? 'flex-[56_1_0] p-12' : 'pt-12'}`}
        >
          <Logo size={wide ? 240 : 120} />
        </motion.div>
        <div
          className={`flex items-center justify-center px-10 py-12 ${wide ? 'flex-[44_1_0]' : ''}`}
        >
          <div className="flex w-full max-w-[400px] flex-col">
            <h1 className="text-hero font-semibold tracking-[-0.02em]">
              Welcome to wavebit
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Your music files and your Spotify library, in one quiet player.
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
          </div>
        </div>
      </main>
    </div>
  );
}

function StepList({
  step,
  setStep,
  done,
}: {
  step: number;
  setStep: (s: number) => void;
  done: (i: number) => string | null;
}) {
  return (
    <div className="flex w-full max-w-[320px] flex-col gap-8">
      <Logo size={28} />
      <ol className="flex flex-col gap-6">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const state = n === step ? 'current' : n < step ? 'done' : 'todo';
          const marker = (
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[0.8667rem] font-semibold ${
                state === 'current'
                  ? 'bg-accent text-accent-foreground'
                  : state === 'done'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-sunken text-muted'
              }`}
            >
              {state === 'done' ? (
                <Check size={14} strokeWidth={3} aria-hidden />
              ) : (
                n
              )}
            </span>
          );
          return (
            <li
              key={s.name}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex items-start gap-3.5"
            >
              {state === 'done' ? (
                <button
                  type="button"
                  onClick={() => setStep(n)}
                  aria-label={`Back to step ${n}, ${s.name}`}
                  className="rounded-full"
                >
                  {marker}
                </button>
              ) : (
                marker
              )}
              <span className="flex flex-col gap-0.5 pt-0.5">
                <span
                  className={
                    state === 'current'
                      ? 'font-semibold'
                      : state === 'todo'
                        ? 'font-medium text-muted'
                        : 'font-medium'
                  }
                >
                  {s.name}
                </span>
                <span className="text-sm text-muted">
                  {(state === 'done' && done(i)) || s.hint}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
      <Button
        variant="secondary"
        size="lg"
        className="h-12 rounded-full"
        onPress={back}
      >
        <ArrowLeft size={18} aria-hidden />
        Back
      </Button>
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

/** DESIGN.md › Welcome and setup. Setup never blocks the app; every step can be skipped. */
export function Onboarding({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const set = (patch: SettingsPatch) => update.mutate(patch);
  const step = settings.setupStep;
  const setStep = (setupStep: number) => set({ setupStep });
  const wide = useWindowWidth() >= BREAKPOINTS.split;
  const library = useLibraryState().data;
  const spotify = useSpotifyStatus().data;
  const [sheet, setSheet] = useState(false);
  const finish = () => {
    nav.go(
      spotify?.state === 'signed_in'
        ? { name: 'home' }
        : { name: 'library', tab: 'songs' },
    );
    set({ setupStep: 4 });
  };

  if (step === 0) return <Welcome go={() => setStep(1)} skip={finish} />;

  const left = wide ? (
    <StepList
      step={step}
      setStep={setStep}
      done={(i) =>
        i === 0 && library?.trackCount
          ? `${count(library.trackCount, 'song')} found`
          : i === 1 && spotify?.state === 'signed_in'
            ? `Connected${spotify.profile ? ` as ${spotify.profile.name}` : ''}`
            : null
      }
    />
  ) : (
    <div className="flex flex-col gap-5">
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        className="grid grid-cols-3 gap-1.5"
      >
        {STEPS.map((s, i) => (
          <span
            key={s.name}
            className={`h-1.5 rounded-full ${i < step ? 'bg-accent' : 'bg-sunken'}`}
          />
        ))}
      </div>
      <Logo size={28} />
    </div>
  );

  return (
    <Split left={left} wide={wide}>
      <span className="text-[0.8667rem] font-medium text-muted">
        Step {step} of 3
      </span>
      {step === 1 && (
        <>
          <h1 className="mt-2 text-step font-semibold tracking-[-0.02em]">
            Add your music
          </h1>
          <p className="mt-3 leading-relaxed text-muted">
            Choose the folders that hold your music files. wavebit reads them
            where they are and never moves or changes them.
          </p>
          <div className="mt-7">
            <FolderList pill />
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
        <>
          <h1 className="mt-2 text-step font-semibold tracking-[-0.02em]">
            Connect Spotify
          </h1>
          <p className="mt-3 leading-relaxed text-muted">
            See your playlists and Liked Songs here, and play the ones you
            already have as files.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <span className="flex items-center gap-3">
              <Check size={18} className="text-success" aria-hidden />
              Reads your playlists and Liked Songs
            </span>
            <span className="flex items-center gap-3">
              <Check size={18} className="text-success" aria-hidden />
              Reads your name and profile picture
            </span>
            <p className="ml-[30px] text-sm leading-normal text-muted">
              Never posts, follows, changes playlists or sees your password.{' '}
              <Link
                onPress={() => setSheet(true)}
                className="cursor-pointer font-medium text-accent"
              >
                What wavebit can see
              </Link>
            </p>
          </div>
          <div className="mt-7">
            {spotify?.state === 'signed_in' ? (
              <p className="flex items-center gap-2 font-medium">
                <Check size={18} className="text-success" aria-hidden />
                Connected{spotify.profile ? ` as ${spotify.profile.name}` : ''}
              </p>
            ) : (
              <ConnectSpotify pill onConnected={() => setStep(3)} />
            )}
          </div>
          <WhatWavebitSees isOpen={sheet} onOpenChange={setSheet} />
          <Footer
            back={() => setStep(1)}
            skip={spotify?.state === 'signed_in' ? undefined : () => setStep(3)}
            next={spotify?.state === 'signed_in' ? () => setStep(3) : undefined}
          />
        </>
      )}
      {step === 3 && (
        <>
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
