import { Alert, Avatar, Button, toast } from '@heroui/react';
import { useState } from 'react';
import { errorCode } from '../../../shared/errors';
import { YouTubeMusicMark } from '../../design/BrandMarks';
import { Group } from './rows';
import {
  useGoogleAccount,
  useYtOAuth,
  useYtOAuthActions,
} from '../../lib/queries';

const field =
  'h-10 w-full rounded-md bg-sunken px-3 text-sm ring-1 ring-[var(--field-border)] outline-none focus:ring-2 focus:ring-accent';

/** Pasting your own Desktop-app OAuth client, with the steps to make one. */
function SetUp() {
  const { configure } = useYtOAuthActions();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const valid =
    /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId.trim()) &&
    /^[A-Za-z0-9_-]{10,100}$/.test(clientSecret.trim());
  return (
    <div className="mt-3 flex max-w-xl flex-col gap-4">
      <p className="text-muted">
        Google signs you in on its own page in your browser. wavebit needs an
        OAuth client of yours for that, made once, free:
      </p>
      <ol className="ml-5 list-decimal space-y-1.5 text-sm text-muted">
        <li>
          In Google Cloud Console, create a project and enable{' '}
          <span className="text-foreground">YouTube Data API v3</span>.
        </li>
        <li>
          Set up the OAuth consent screen (External) and add your Google account
          as a test user.
        </li>
        <li>
          Under Credentials, create an{' '}
          <span className="text-foreground">OAuth client ID</span> of type{' '}
          <span className="text-foreground">Desktop app</span>, and paste its ID
          and secret here.
        </li>
      </ol>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Client ID
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="1234567890-abc….apps.googleusercontent.com"
          spellCheck={false}
          autoComplete="off"
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Client secret
        <input
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          type="password"
          spellCheck={false}
          autoComplete="off"
          className={field}
        />
      </label>
      <div>
        <Button
          isDisabled={!valid}
          isPending={configure.isPending}
          onPress={() =>
            configure.mutate({
              clientId: clientId.trim(),
              clientSecret: clientSecret.trim(),
            })
          }
        >
          Save
        </Button>
      </div>
      <p className="text-sm text-muted">
        Both are encrypted with your system keyring and stay in wavebit’s
        background process. wavebit asks for read-only access.
      </p>
    </div>
  );
}

/**
 * Settings › YouTube Music: Google's own sign-in in the default browser
 * (Google refuses sign-in inside apps), then the account it reads.
 */
export function YouTubeSection() {
  const oauth = useYtOAuth().data;
  const account = useGoogleAccount(!!oauth?.signedIn);
  const { signIn, signOut, cancel } = useYtOAuthActions();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Group title="Account" anchor="youtubeAccount">
        <div className="px-4 pt-1 pb-4">
          {oauth?.signedIn ? (
            <div className="mt-3 flex items-center gap-3.5">
              <Avatar className="size-10">
                {account.data?.imageUrl && (
                  <Avatar.Image src={account.data.imageUrl} alt="" />
                )}
                <Avatar.Fallback>
                  <YouTubeMusicMark size={40} />
                </Avatar.Fallback>
              </Avatar>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">
                  {account.data
                    ? `Signed in as ${account.data.name}`
                    : 'Signed in'}
                </span>
                <span className="text-sm text-muted tabular-nums">
                  {account.data
                    ? `${account.data.playlists.length} playlists · ${account.data.liked.length} liked · ${account.data.subscriptions.length} subscriptions`
                    : 'Reading your YouTube account…'}
                </span>
              </span>
              <Button
                variant="danger-soft"
                isPending={signOut.isPending}
                onPress={() =>
                  signOut.mutate(undefined, {
                    onSuccess: () => toast('Signed out of YouTube'),
                  })
                }
              >
                Sign out
              </Button>
            </div>
          ) : oauth?.configured ? (
            <div className="mt-3 flex max-w-md flex-col gap-3">
              <p className="text-muted">
                Your browser opens Google’s sign-in page. When it says you can
                close the tab, come back here.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  isPending={signIn.isPending}
                  onPress={() => {
                    setError(null);
                    signIn.mutate(undefined, {
                      onError: (e) =>
                        setError(
                          errorCode(e) === 'cancelled'
                            ? null
                            : errorCode(e) === 'timed_out'
                              ? 'The browser didn’t come back within 5 minutes.'
                              : 'Google didn’t finish signing in. Check the client ID and secret, and that you are a test user.',
                        ),
                    });
                  }}
                >
                  <YouTubeMusicMark size={18} mono />
                  Sign in with your browser
                </Button>
                {signIn.isPending && (
                  <Button variant="ghost" onPress={cancel}>
                    Cancel
                  </Button>
                )}
              </div>
              {error && (
                <Alert status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{error}</Alert.Title>
                  </Alert.Content>
                </Alert>
              )}
            </div>
          ) : (
            <SetUp />
          )}
        </div>
      </Group>
      <Group title="What wavebit reads" anchor="youtubeReads">
        <p className="max-w-xl p-4 text-muted">
          Your playlists, liked videos and subscriptions, through the YouTube
          Data API with read-only access. Home’s YouTube Music shelves are
          YouTube Music’s public feed. Songs play in YouTube’s own embedded
          player, which stays on screen while it plays.
        </p>
      </Group>
      {oauth?.configured && !oauth.signedIn && (
        <details className="mt-6 max-w-xl text-sm">
          <summary className="cursor-pointer font-medium">
            Use a different OAuth client
          </summary>
          <SetUp />
        </details>
      )}
    </>
  );
}
