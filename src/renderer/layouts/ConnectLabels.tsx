import { toast } from '@heroui/react';
import { FolderPlus } from 'lucide-react';
import { errorCode } from '../../shared/errors';
import { nav } from '../app/router';
import { SpotifyMark, YouTubeMusicMark } from '../design/BrandMarks';
import { IconAction } from '../design/IconAction';
import { SPOTIFY_ERRORS } from '../features/spotify/ConnectSpotify';
import {
  useAddFolder,
  useLibraryState,
  useSpotifyActions,
  useSpotifyStatus,
  useYtOAuth,
} from '../lib/queries';
import { UpdateLabel } from './UpdateLabel';

const FOLDER_REFUSED = {
  root: 'Choose a folder inside the disk, not the whole disk.',
  home: 'Choose a folder inside your home folder, not all of it.',
  duplicate: 'That folder is already in your library.',
  limit: 'wavebit can hold 20 music folders.',
} as const;

/** The whole 32px square takes the click; only the icon is drawn. */
const SIZE = 32;
const ICON = 18;

/**
 * DESIGN.md › Title bar: what still needs setting up, as bare icons just
 * before the window controls. Each goes away once its service is connected.
 */
export function ConnectLabels() {
  const spotify = useSpotifyStatus().data;
  const { signIn } = useSpotifyActions();
  const google = useYtOAuth().data;
  const folders = useLibraryState().data?.folders.length;
  const add = useAddFolder();

  const connectSpotify = () =>
    signIn.mutate(undefined, {
      onSuccess: (next) =>
        toast.success(
          next.state === 'signed_in' && next.profile
            ? `Connected as ${next.profile.name}`
            : 'Spotify connected',
        ),
      onError: (error) => {
        const code = errorCode(error) ?? 'network';
        // Closing the window or backing out was the listener's own choice.
        if (code === 'cancelled' || code === 'closed') return;
        toast.danger(SPOTIFY_ERRORS[code].title, {
          description: SPOTIFY_ERRORS[code].body,
        });
      },
    });

  const addFolder = () =>
    add.mutate(undefined, {
      onSuccess: (result) => {
        if (!result.ok && result.reason !== 'cancelled')
          toast.danger(FOLDER_REFUSED[result.reason]);
      },
    });

  return (
    <div className="no-drag flex items-center gap-1 pr-2">
      <UpdateLabel />
      {spotify && spotify.state !== 'signed_in' && (
        <IconAction
          label="Connect Spotify"
          size={SIZE}
          isPending={signIn.isPending}
          onPress={connectSpotify}
        >
          <SpotifyMark size={ICON} />
        </IconAction>
      )}
      {google && !google.signedIn && (
        <IconAction
          label="Connect YouTube Music"
          size={SIZE}
          onPress={() => nav.go({ name: 'settings', section: 'youtube' })}
        >
          <YouTubeMusicMark size={ICON} />
        </IconAction>
      )}
      {folders === 0 && (
        <IconAction
          label="Add a music folder to your library"
          size={SIZE}
          isPending={add.isPending}
          onPress={addFolder}
        >
          <FolderPlus size={ICON} aria-hidden />
        </IconAction>
      )}
    </div>
  );
}
