import { Alert, Button, Link } from '@heroui/react';
import { useState } from 'react';
import { errorCode } from '../../../shared/errors';
import { Empty } from '../../design/Empty';
import {
  ConnectSpotify,
  SPOTIFY_ERRORS,
  WhatWavebitSees,
} from './ConnectSpotify';

export function SpotifyError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const message = SPOTIFY_ERRORS[errorCode(error) ?? 'network'];
  return (
    <Alert status="danger" role="alert" className="mt-6">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{message.title}</Alert.Title>
        <Alert.Description>{message.body}</Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="secondary" onPress={retry}>
        Try again
      </Button>
    </Alert>
  );
}

/** The Spotify signed-out state, centred in the workspace (DESIGN.md › Spotify). */
export function SignedOut() {
  const [sheet, setSheet] = useState(false);
  return (
    <Empty
      art="playlist"
      title="Connect Spotify to see your playlists"
      action={
        <div className="flex w-64 flex-col items-center gap-3">
          <ConnectSpotify />
          <Link
            onPress={() => setSheet(true)}
            className="cursor-pointer text-sm font-medium text-accent"
          >
            What wavebit can see
          </Link>
          <WhatWavebitSees isOpen={sheet} onOpenChange={setSheet} />
        </div>
      }
    >
      Your playlists and Liked Songs show here, and songs you already have as
      files play from them.
    </Empty>
  );
}
