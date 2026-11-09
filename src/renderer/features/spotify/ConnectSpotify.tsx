import { Alert, Button, Kbd, Spinner, toast } from '@heroui/react';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorCode } from '../../../shared/errors';
import type { ErrorCode } from '../../../shared/schemas/spotify';
import { SideOrBottomSheet } from '../../design/Sheet';
import { SpotifyMark } from '../../design/BrandMarks';
import { useSpotifyActions, useSpotifyStatus } from '../../lib/queries';

export const SPOTIFY_ERRORS: Record<
  ErrorCode,
  { title: string; body: string }
> = {
  cancelled: {
    title: 'Signing in was cancelled',
    body: 'Nothing was saved. Connect again when you’re ready.',
  },
  closed: {
    title: 'The Spotify window was closed',
    body: 'Nothing was saved. Connect again when you’re ready.',
  },
  timed_out: {
    title: 'Signing in timed out',
    body: 'The Spotify window was open for 10 minutes without finishing.',
  },
  network: {
    title: 'Couldn’t reach Spotify',
    body: 'Check your connection and try again.',
  },
  failed: {
    title: 'Something went wrong',
    body: 'Try again. If it keeps happening, restart wavebit.',
  },
  changed: {
    title: 'Spotify changed its web player',
    body: 'wavebit can’t read your library until it is updated.',
  },
  signed_out: {
    title: 'Spotify signed you out',
    body: 'Connect again to see your playlists.',
  },
  rate_limited: {
    title: 'Spotify asked wavebit to slow down',
    body: 'Try again in a minute.',
  },
};

/** DESIGN.md › Setup step 2: what wavebit reads, in plain words. */
export function WhatWavebitSees({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const storage = useSpotifyStatus().data?.storage ?? 'keyring';
  const Line = ({ ok, children }: { ok: boolean; children: string }) => (
    <div className="flex items-start gap-3">
      {ok ? (
        <Check size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
      ) : (
        <X size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      )}
      <span className="leading-relaxed">{children}</span>
    </div>
  );
  return (
    <SideOrBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="What wavebit can see"
    >
      <div className="flex flex-col gap-7 pb-6">
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">wavebit reads</h3>
          <Line ok>Your playlists and Liked Songs</Line>
          <Line ok>Your name and profile picture</Line>
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">wavebit never</h3>
          <Line ok={false}>Posts, follows, or changes your playlists</Line>
          <Line ok={false}>
            Sees your password. You type it on Spotify’s own page.
          </Line>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Where the session is kept</h3>
          <p className="leading-relaxed text-muted">
            {storage === 'keyring'
              ? 'In this computer’s cookie store, encrypted with your system keyring. Signing out in Settings deletes it.'
              : 'In memory only, until wavebit quits, because this desktop has no keyring to encrypt it with.'}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Not an official Spotify app</h3>
          <p className="leading-relaxed text-muted">
            wavebit uses the same session as Spotify’s web player. Spotify may
            change it at any time, and then wavebit’s Spotify pages stop until
            wavebit is updated.
          </p>
        </section>
      </div>
    </SideOrBottomSheet>
  );
}

/** The Connect Spotify button with its waiting, error and connected states. */
export function ConnectSpotify({
  pill = false,
  onConnected,
}: {
  pill?: boolean;
  onConnected?: () => void;
}) {
  const { signIn, cancel } = useSpotifyActions();
  const [error, setError] = useState<ErrorCode | null>(null);
  // Only this button's own request: a stale 'signing_in' event must never leave it spinning.
  const waiting = signIn.isPending;
  const radius = pill ? 'rounded-full h-12' : '';

  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [waiting, cancel]);

  const connect = () => {
    setError(null);
    signIn.mutate(undefined, {
      onSuccess: (next) => {
        toast.success(
          next.state === 'signed_in' && next.profile
            ? `Connected as ${next.profile.name}`
            : 'Spotify connected',
        );
        onConnected?.();
      },
      onError: (e) => setError(errorCode(e) ?? 'network'),
    });
  };

  const message = error && SPOTIFY_ERRORS[error];
  return (
    <div className="flex flex-col">
      <Button
        className={`w-full ${radius}`}
        onPress={connect}
        isPending={waiting}
        aria-busy={waiting}
      >
        {({ isPending }) => (
          <>
            {isPending ? (
              <Spinner size="sm" color="current" />
            ) : (
              <SpotifyMark size={18} mono />
            )}
            {error ? 'Try again' : 'Connect Spotify'}
          </>
        )}
      </Button>
      {waiting && (
        <>
          <p className="mt-3.5 text-sm leading-normal text-muted">
            Finish signing in in the Spotify window. It shows{' '}
            <span className="font-medium text-foreground">
              accounts.spotify.com
            </span>{' '}
            in its title.
          </p>
          <div className="mt-2.5 flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              className={pill ? 'rounded-full' : ''}
              onPress={cancel}
            >
              Cancel
            </Button>
            <span className="flex items-center gap-1.5 text-[0.8667rem] text-muted">
              or press <Kbd>Esc</Kbd>
            </span>
          </div>
        </>
      )}
      {message && !waiting && (
        <Alert status="danger" role="alert" className="mt-4">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{message.title}</Alert.Title>
            <Alert.Description>{message.body}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}
