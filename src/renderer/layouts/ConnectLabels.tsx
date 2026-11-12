import { Avatar, Button, Spinner, toast, Tooltip } from '@heroui/react';
import { FolderPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorCode } from '../../shared/errors';
import { nav } from '../app/router';
import { SpotifyMark, YouTubeMusicMark } from '../design/BrandMarks';
import { IconAction } from '../design/IconAction';
import { SPOTIFY_ERRORS } from '../features/spotify/ConnectSpotify';
import { count } from '../lib/format';
import {
  useAddFolder,
  useGoogleAccount,
  useLibraryState,
  usePlaylists,
  useSpotifyActions,
  useSpotifyAlbums,
  useSpotifyArtists,
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

/** An account's circle in the stack, and its picture in the card. */
const AVATAR = 32;
const CARD_AVATAR = 44;

function Picture({
  image,
  mark,
  size,
}: {
  image: string | null | undefined;
  /** The service's own mark: shown until signed in, or when there's no picture. */
  mark: (size: number) => ReactNode;
  size: number;
}) {
  return (
    <Avatar style={{ width: size, height: size }} className="shrink-0">
      {image && <Avatar.Image src={image} alt="" />}
      <Avatar.Fallback>{mark(size)}</Avatar.Fallback>
    </Avatar>
  );
}

/**
 * One account in the stack: its picture once signed in, the service's mark
 * until then. Hovering (or focusing) it opens a card, which is only mounted
 * while open, so the details inside are read then and not before.
 */
function Account({
  label,
  image,
  mark,
  name,
  line,
  isPending = false,
  onPress,
  children,
}: {
  label: string;
  image: string | null | undefined;
  mark: (size: number) => ReactNode;
  name: string;
  /** Under the name: the service, or that it isn't connected. */
  line: string;
  isPending?: boolean;
  onPress: () => void;
  /** The card's last line. */
  children: ReactNode;
}) {
  return (
    <Tooltip delay={250} closeDelay={0}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={label}
          isPending={isPending}
          onPress={onPress}
          style={{ width: AVATAR, height: AVATAR, minWidth: AVATAR }}
          className="icon-sized relative rounded-full bg-canvas p-0 ring-2 ring-canvas transition-transform hover:z-10 hover:scale-110 focus-visible:z-10"
        >
          {({ isPending: busy }) =>
            busy ? (
              <Spinner size="sm" color="current" />
            ) : (
              <Picture image={image} mark={mark} size={AVATAR} />
            )
          }
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom end" offset={10} className="p-3">
        <div className="flex w-56 flex-col gap-2.5 text-left">
          <div className="flex items-center gap-3">
            <Picture image={image} mark={mark} size={CARD_AVATAR} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {name}
              </span>
              <span className="truncate text-xs text-muted">{line}</span>
            </span>
          </div>
          <p className="text-xs text-muted tabular-nums">{children}</p>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

/** What the Spotify account holds. Read when its card opens. */
function SpotifyFacts() {
  const playlists = usePlaylists(true);
  const albums = useSpotifyAlbums(true);
  const artists = useSpotifyArtists(true);
  const facts = [
    playlists.data &&
      count(playlists.data.filter((p) => !p.imported).length, 'playlist'),
    albums.data && count(albums.data.length, 'album'),
    artists.data && count(artists.data.length, 'artist'),
  ].filter(Boolean);
  if (facts.length > 0) return facts.join(' · ');
  return playlists.isPending || albums.isPending || artists.isPending
    ? 'Reading your Spotify library…'
    : 'Press to open Spotify in Settings.';
}

const spotifyMark = (size: number) => <SpotifyMark size={size} />;
const youtubeMark = (size: number) => <YouTubeMusicMark size={size} />;

/**
 * DESIGN.md › Title bar: the two accounts as a stack of circles, then what
 * still needs setting up, just before the window controls.
 */
export function ConnectLabels() {
  const spotify = useSpotifyStatus().data;
  const { signIn } = useSpotifyActions();
  const google = useYtOAuth().data;
  const googleAccount = useGoogleAccount(!!google?.signedIn);
  const profile = spotify?.state === 'signed_in' ? spotify.profile : null;
  const openSettings = (section: 'spotify' | 'youtube') =>
    nav.go({ name: 'settings', section });
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
      <div className="isolate mx-1 flex items-center -space-x-2">
        {spotify &&
          (spotify.state === 'signed_in' ? (
            <Account
              label={`Spotify: signed in as ${profile?.name ?? 'your account'}`}
              image={profile?.imageUrl}
              mark={spotifyMark}
              name={profile?.name ?? 'Connected'}
              line="Spotify"
              onPress={() => openSettings('spotify')}
            >
              <SpotifyFacts />
            </Account>
          ) : (
            <Account
              label="Connect Spotify"
              image={null}
              mark={spotifyMark}
              name="Spotify"
              line="Not connected"
              isPending={signIn.isPending}
              onPress={connectSpotify}
            >
              Press to sign in to Spotify.
            </Account>
          ))}
        {google &&
          (google.signedIn ? (
            <Account
              label={`YouTube Music: signed in as ${googleAccount.data?.name ?? 'your account'}`}
              image={googleAccount.data?.imageUrl}
              mark={youtubeMark}
              name={googleAccount.data?.name ?? 'Signed in'}
              line="YouTube Music"
              onPress={() => openSettings('youtube')}
            >
              {googleAccount.data
                ? `${count(googleAccount.data.playlists.length, 'playlist')} · ${googleAccount.data.liked.length} liked · ${count(googleAccount.data.subscriptions.length, 'subscription')}`
                : googleAccount.isPending
                  ? 'Reading your YouTube account…'
                  : 'Press to open YouTube Music in Settings.'}
            </Account>
          ) : (
            <Account
              label="Connect YouTube Music"
              image={null}
              mark={youtubeMark}
              name="YouTube Music"
              line="Not connected"
              onPress={() => openSettings('youtube')}
            >
              Press to set it up in Settings.
            </Account>
          ))}
      </div>
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
