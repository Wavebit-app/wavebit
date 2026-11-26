import { Input, Switch, TextField } from '@heroui/react';
import { EyeOff, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  fillLabel,
  LABEL_LIMIT,
  LABEL_VARIABLES,
  type LabelSong,
} from '../../../shared/discordText';
import type { DiscordState } from '../../../shared/schemas/discord';
import type { Settings } from '../../../shared/schemas/settings';
import { IconAction } from '../../design/IconAction';
import { Segmented } from '../../design/Segmented';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import { setDiscordPrivate, useDiscord } from '../discord/useDiscord';
import { usePlayer, type Playable } from '../player/player';
import { DiscordAvatar, type DiscordDot } from './DiscordAvatar';
import { DiscordPreview } from './DiscordPreview';
import { Group, Row, SettingSwitch } from './rows';
import { setting } from './settingsIndex';

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** "Updated 12 s ago", kept current while the section is open. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function AccountCard({
  state,
  enabled,
}: {
  state: DiscordState | null;
  enabled: boolean;
}) {
  const now = useNow(!!state?.sentAt);
  const status = state?.status ?? 'disabled';
  const connected = status === 'connected';

  let dot: DiscordDot = 'off';
  let line: React.ReactNode = 'Presence is off.';
  if (status === 'not_configured') {
    dot = null;
    line = 'Add a Discord application ID under Application to turn this on.';
  } else if (!enabled) {
    dot = 'off';
  } else if (!connected && state?.problem === 'app_id') {
    // Checked before "connecting": wavebit keeps retrying, which would hide it.
    dot = 'warning';
    line = 'Discord didn’t accept the application ID.';
  } else if (status === 'connecting') {
    dot = 'faint';
    line = 'Looking for Discord…';
  } else if (status === 'waiting') {
    dot = 'warning';
    line = 'Discord isn’t running. wavebit keeps checking.';
  } else if (connected && state?.private) {
    dot = 'accent';
    line = 'Private listening until you turn it off or quit';
  } else if (connected) {
    dot = 'success';
    line =
      state?.showing && state.song ? (
        <>
          Showing{' '}
          <strong className="font-medium text-foreground">
            {state.song.title}
          </strong>
          {state.sentAt && ` · updated ${ago(now - state.sentAt)}`}
        </>
      ) : state?.song ? (
        'Card hidden'
      ) : (
        'Connected through Discord on this computer'
      );
  }

  const user = connected ? state?.user : null;
  return (
    <>
      <div className="flex items-center gap-3.5 py-3.5 pr-2 pl-4">
        <DiscordAvatar user={user} size={56} dot={dot} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">
              {user?.name ?? 'Discord'}
            </span>
            {connected && state?.client && (
              <span className="flex h-5 shrink-0 items-center rounded-full bg-sunken px-2 text-xs font-medium text-muted">
                {state.client}
              </span>
            )}
          </span>
          {user && (
            <span className="truncate text-sm text-muted">
              @{user.username}
            </span>
          )}
          <span
            role="status"
            aria-live="polite"
            className="truncate text-sm text-muted"
          >
            {line}
          </span>
        </span>
        {enabled && connected && (
          <IconAction
            label={
              state?.private
                ? 'Turn off private listening'
                : 'Private listening'
            }
            active={state?.private}
            onPress={() => setDiscordPrivate(!state?.private)}
          >
            <EyeOff size={18} aria-hidden />
          </IconAction>
        )}
        {enabled && (status === 'connecting' || status === 'waiting') && (
          <IconAction
            label="Reconnect to Discord"
            onPress={() => void window.wavebit.discord.retry().catch(() => {})}
          >
            <RefreshCw size={18} aria-hidden />
          </IconAction>
        )}
      </div>
      {enabled && state?.problem === 'rejected' && (
        <p
          role="alert"
          className="mx-2.5 mb-2.5 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          Discord didn’t accept the last update. Check the button texts.
        </p>
      )}
    </>
  );
}

const APP_ID = /^\d{17,20}$/;
const PORTAL = 'https://discord.com/developers/applications';

/**
 * The Discord application the card is published as. Its ID is public, not a
 * secret; Discord shows the application's name after "Listening to".
 */
function ApplicationId({
  saved,
  source,
  refused,
  onSave,
}: {
  saved: string;
  source: DiscordState['appIdSource'];
  refused: boolean;
  onSave: (id: string) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const editing = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (!editing.current) setDraft(saved);
  }, [saved]);

  const value = draft.trim();
  const invalid = value !== '' && !APP_ID.test(value);
  const commit = () => {
    editing.current = false;
    if (!invalid && value !== saved) save.current(value);
  };
  // Saved a moment after a valid ID is typed or pasted, and on leaving the field.
  useEffect(() => {
    if (invalid || value === saved) return;
    const timer = setTimeout(() => save.current(value), 600);
    return () => clearTimeout(timer);
  }, [invalid, value, saved]);

  const note = invalid
    ? 'An application ID is 17 to 20 digits.'
    : refused
      ? 'Discord didn’t accept this ID. Check that it is the Application ID from the developer portal.'
      : source === 'launch' && !value
        ? 'Using the ID wavebit was started with.'
        : source === 'build' && !value
          ? 'Using the ID built into this copy of wavebit. Paste another to use your own.'
          : !value
            ? 'This copy of wavebit has none built in, so paste yours here.'
            : null;

  return (
    <Group
      title="Application"
      footer={
        <>
          Make one at{' '}
          <a
            href={PORTAL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            discord.com/developers/applications
          </a>
          : New Application, name it wavebit (Discord shows that name after
          “Listening to”), then copy its Application ID. It is public, not a
          secret.
        </>
      }
    >
      <div
        data-setting="discordClientId"
        className="flex flex-col gap-2 px-4 py-3"
      >
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {setting('discordClientId').label}
          </span>
          <span className="text-sm text-muted">
            {setting('discordClientId').hint}
          </span>
        </span>
        <TextField
          aria-label="Discord application ID"
          value={draft}
          onChange={(next) => setDraft(next.replace(/\s+/g, ''))}
          onFocus={() => (editing.current = true)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          isInvalid={invalid}
          maxLength={20}
        >
          <Input
            placeholder="For example 1234567890123456789"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono tabular-nums"
          />
        </TextField>
        {note && (
          <span
            role={invalid || refused ? 'alert' : undefined}
            className={`text-sm ${invalid || refused ? 'text-danger' : 'text-muted'}`}
          >
            {note}
          </span>
        )}
      </div>
    </Group>
  );
}

/** The song the labels are filled in with, and its link's default label. */
function useLabelSong(prefer: Settings['discordSongLink']): {
  song: LabelSong | null;
  songLabel: string | null;
} {
  const track = usePlayer((s) => s.queue[s.index] ?? null) as Playable | null;
  if (!track) return { song: null, songLabel: 'Listen on YouTube Music' };
  const youtube = !!track.stream?.videoId;
  const spotify = /^spotify:track:[A-Za-z0-9]{22}$/.test(
    track.spotifyUri ?? '',
  );
  const songLabel =
    prefer === 'spotify' && spotify
      ? 'Open in Spotify'
      : youtube
        ? 'Listen on YouTube Music'
        : spotify
          ? 'Open in Spotify'
          : null;
  return {
    song: { title: track.title, artist: track.artist, album: track.album },
    songLabel,
  };
}

/** A button's switch, label field, variables and what it will show. */
function ButtonEditor({
  id,
  textKey,
  enabled,
  text,
  fallback,
  song,
  noLink,
  children,
}: {
  id: 'discordSongButton' | 'discordAppButton';
  textKey: 'discordSongButtonText' | 'discordAppButtonText';
  enabled: boolean;
  text: string;
  fallback: string;
  song: LabelSong | null;
  noLink?: boolean;
  children?: React.ReactNode;
}) {
  const update = useUpdateSettings();
  const entry = setting(id);
  const [draft, setDraft] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  // Follows the saved value unless the field is being typed in.
  useEffect(() => {
    if (!editing.current) setDraft(text);
  }, [text]);

  // Saved a moment after typing stops, not on every key.
  useEffect(() => {
    if (draft === text) return;
    const timer = setTimeout(() => update.mutate({ [textKey]: draft }), 400);
    return () => clearTimeout(timer);
  }, [draft, text, textKey, update]);

  const filled = fillLabel(draft, fallback, song);
  const insert = (variable: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? at;
    const next = (draft.slice(0, at) + variable + draft.slice(end)).slice(
      0,
      64,
    );
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = Math.min(64, at + variable.length);
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div data-setting={id} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{entry.label}</span>
          <span className="text-sm text-muted">{entry.hint}</span>
        </span>
        {draft && (
          <IconAction
            label={`Reset the ${entry.label.toLowerCase()}’s text`}
            onPress={() => setDraft('')}
          >
            <RotateCcw size={18} aria-hidden />
          </IconAction>
        )}
        <SettingSwitchInline id={id} isSelected={enabled} />
      </div>
      <div
        className={`flex flex-col gap-2 ${enabled ? '' : 'pointer-events-none opacity-45'}`}
        inert={!enabled}
      >
        {children}
        <div className="flex items-center gap-2">
          <TextField
            aria-label={`${entry.label} text`}
            value={draft}
            maxLength={64}
            onChange={setDraft}
            onFocus={() => (editing.current = true)}
            onBlur={() => {
              editing.current = false;
              if (draft !== text) update.mutate({ [textKey]: draft });
            }}
            className="min-w-0 flex-1"
          >
            <Input ref={input} placeholder={fallback} autoComplete="off" />
          </TextField>
          <span
            className={`w-12 text-right text-xs tabular-nums ${filled.cut ? 'font-semibold text-warning' : 'text-muted'}`}
            aria-label={`${filled.length} of ${LABEL_LIMIT} characters`}
          >
            {Math.min(filled.length, 99)}/{LABEL_LIMIT}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LABEL_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="h-6 rounded-full bg-accent-soft px-2 font-mono text-xs font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {v}
            </button>
          ))}
        </div>
        <span
          className={`text-sm ${filled.cut ? 'text-warning' : 'text-muted'}`}
        >
          {noLink ? (
            'This song has no link, so the button is left out.'
          ) : (
            <>
              Shows as:{' '}
              <strong
                className={`font-medium ${filled.cut ? '' : 'text-foreground'}`}
              >
                {filled.text}
              </strong>
              {filled.cut && ' (cut to 32)'}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Just the switch, named for screen readers; only Switch.Content takes the press. */
function SwitchOnly({
  label,
  isSelected,
  onChange,
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch
      aria-label={label}
      isSelected={isSelected}
      onChange={onChange}
      className="shrink-0 cursor-pointer"
    >
      <Switch.Content className="flex items-center">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

/** A switch with no row of its own, for a block that has its own header. */
function SettingSwitchInline({
  id,
  isSelected,
}: {
  id: 'discordSongButton' | 'discordAppButton';
  isSelected: boolean;
}) {
  const update = useUpdateSettings();
  return (
    <SwitchOnly
      label={setting(id).label}
      isSelected={isSelected}
      onChange={(value) => update.mutate({ [id]: value })}
    />
  );
}

export function DiscordSection() {
  const settings = useSettings().data;
  const update = useUpdateSettings();
  const state = useDiscord();
  const labels = useLabelSong(settings?.discordSongLink ?? 'plays');
  if (!settings) return null;
  const enabled = settings.discordPresenceEnabled;
  const set = (patch: Partial<Settings>) => update.mutate(patch);

  return (
    <>
      <Group title="Account">
        <AccountCard state={state} enabled={enabled} />
        <SettingSwitch
          id="discordPresenceEnabled"
          isSelected={enabled}
          onChange={(discordPresenceEnabled) => set({ discordPresenceEnabled })}
        />
        <SettingSwitch
          id="discordPrivate"
          isSelected={!!state?.private}
          isDisabled={!enabled}
          onChange={setDiscordPrivate}
        />
      </Group>

      <ApplicationId
        saved={settings.discordClientId}
        source={state?.appIdSource ?? null}
        refused={state?.problem === 'app_id'}
        onSave={(discordClientId) => set({ discordClientId })}
      />

      <Group
        title="Preview"
        anchor="discordPresenceEnabled"
        footer="Your friends see this. The bar counts on its own: wavebit only updates Discord when the song, a seek, a pause or a setting changes."
      >
        <DiscordPreview state={state} />
      </Group>

      <div
        inert={!enabled}
        className={enabled ? undefined : 'pointer-events-none opacity-45'}
      >
        <Group title="Card">
          <Row id="discordActivityType">
            <Segmented
              label="Activity type"
              value={settings.discordActivityType}
              onChange={(discordActivityType) => set({ discordActivityType })}
              options={[
                { value: 'listening', label: 'Listening' },
                { value: 'playing', label: 'Playing' },
                { value: 'watching', label: 'Watching' },
                { value: 'competing', label: 'Competing' },
              ]}
            />
          </Row>
          <Row id="discordStatusDisplay">
            <Segmented
              label="Status line"
              value={settings.discordStatusDisplay}
              onChange={(discordStatusDisplay) => set({ discordStatusDisplay })}
              options={[
                { value: 'artist', label: 'Artist' },
                { value: 'title', label: 'Song' },
                { value: 'app', label: 'wavebit' },
              ]}
            />
          </Row>
        </Group>

        <Group title="Details">
          {(
            [
              'discordShowAlbum',
              'discordShowArtwork',
              'discordShowSource',
              'discordShowProgress',
              'discordShowSpeed',
              'discordShowQuality',
            ] as const
          ).map((id) => (
            <SettingSwitch
              key={id}
              id={id}
              isSelected={settings[id]}
              onChange={(value) => set({ [id]: value })}
            />
          ))}
        </Group>

        <Group title="Privacy">
          <SettingSwitch
            id="discordShareFiles"
            isSelected={settings.discordShareFiles}
            onChange={(discordShareFiles) => set({ discordShareFiles })}
          />
          <Row id="discordWhenPaused">
            <Segmented
              label="When paused"
              value={settings.discordWhenPaused}
              onChange={(discordWhenPaused) => set({ discordWhenPaused })}
              options={[
                { value: 'hide', label: 'Hide the card' },
                { value: 'show', label: 'Show paused' },
              ]}
            />
          </Row>
        </Group>

        <Group
          title="Buttons"
          footer="Press a variable to put it in the label. A label is cut to 32 characters after the variables are filled in, and the counter turns amber when this song’s label would be cut. Discord hides your own buttons from you; friends see them."
        >
          <ButtonEditor
            id="discordSongButton"
            textKey="discordSongButtonText"
            enabled={settings.discordSongButton}
            text={settings.discordSongButtonText}
            fallback={labels.songLabel ?? 'Listen on YouTube Music'}
            song={labels.song}
            noLink={!labels.songLabel}
          >
            <Segmented
              label="Song button opens"
              value={settings.discordSongLink}
              onChange={(discordSongLink) => set({ discordSongLink })}
              options={[
                { value: 'plays', label: 'Where it plays' },
                { value: 'spotify', label: 'Spotify when known' },
              ]}
            />
          </ButtonEditor>
          <ButtonEditor
            id="discordAppButton"
            textKey="discordAppButtonText"
            enabled={settings.discordAppButton}
            text={settings.discordAppButtonText}
            fallback="Get wavebit"
            song={labels.song}
          />
        </Group>
      </div>

      <p className="mt-6 px-4 text-sm leading-normal text-muted">
        wavebit sends the title, artist, album, cover address, times and button
        links, only while presence is on and a song plays, to the Discord app on
        this computer and nowhere else. It never signs in to Discord. This way
        it can’t set online, idle or do not disturb, rename the activity, or
        work while Discord isn’t running.
      </p>
    </>
  );
}
