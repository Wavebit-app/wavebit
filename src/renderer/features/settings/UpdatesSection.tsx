import { Button, Spinner } from '@heroui/react';
import type {
  NotesTarget,
  UpdateStatus,
} from '../../../shared/schemas/updates';
import { WaveRing } from '../../design/WaveRing';
import {
  useReleaseNotes,
  useSettings,
  useUpdateSettings,
  useUpdateStatus,
} from '../../lib/queries';
import { Group, SettingSwitch } from './rows';

const updates = () => window.wavebit.updates;
const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

const ERRORS: Record<NonNullable<UpdateStatus['error']>, string> = {
  network:
    "Couldn't reach the update server. Check your connection and try again.",
  failed: "Couldn't check for updates. Try again in a moment.",
  install: "Couldn't start the installer. Restart wavebit and try again.",
};

function describe(status: UpdateStatus): {
  title: string;
  hint: string;
  danger?: boolean;
} {
  const { state, version, progress = 0, transferred, total, error } = status;
  switch (state) {
    case 'unavailable':
      return {
        title: 'Check for updates',
        hint: 'Updates only work in an installed copy of wavebit.',
      };
    case 'checking':
      return { title: 'Check for updates', hint: 'Checking for updates…' };
    case 'up-to-date':
      return {
        title: 'Check for updates',
        hint: "You're on the latest version. Checked just now.",
      };
    case 'available':
      return {
        title: `wavebit ${version} is out`,
        hint: 'Nothing has been downloaded yet.',
      };
    case 'downloading':
      return {
        title: `Updating to ${version}`,
        hint:
          total && transferred !== undefined
            ? `${Math.round(progress)}% · ${mb(transferred)} of ${mb(total)}`
            : `${Math.round(progress)}%`,
      };
    case 'downloaded':
      return {
        title: `wavebit ${version} is ready`,
        hint: 'Restart to finish. wavebit closes, installs and opens again.',
      };
    case 'installing':
      return { title: `wavebit ${version} is ready`, hint: 'Restarting…' };
    case 'manual':
      return {
        title: `wavebit ${version} is out`,
        hint: "This copy can't update itself. Get the new version from the Releases page.",
      };
    case 'error':
      return {
        title: 'Check for updates',
        hint: ERRORS[error ?? 'failed'],
        danger: true,
      };
    default:
      return {
        title: 'Check for updates',
        hint: 'wavebit looks for new versions by itself.',
      };
  }
}

function Action({ status }: { status: UpdateStatus }) {
  const { state } = status;
  if (state === 'unavailable' || state === 'downloading') return null;
  if (state === 'checking' || state === 'installing')
    return <Spinner size="sm" color="current" className="text-accent" />;
  if (state === 'downloaded')
    return (
      <Button
        variant="primary"
        size="sm"
        onPress={() => void updates().install()}
      >
        Restart to update
      </Button>
    );
  if (state === 'manual')
    return (
      <Button
        variant="primary"
        size="sm"
        onPress={() => void updates().open('releases')}
      >
        Download update
      </Button>
    );
  if (state === 'available')
    return (
      <Button
        variant="secondary"
        size="sm"
        onPress={() => void updates().download()}
      >
        Download
      </Button>
    );
  return (
    <Button
      variant="secondary"
      size="sm"
      onPress={() => void updates().check()}
    >
      {state === 'error' ? 'Try again' : 'Check now'}
    </Button>
  );
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** One release's details, live from GitHub or the copy saved on this computer. */
function ReleaseDetails({
  target,
  version,
  showVersion = false,
}: {
  target: NotesTarget;
  version: string | undefined;
  showVersion?: boolean;
}) {
  const query = useReleaseNotes(target, version);
  const notes = query.data;
  const link = (label: string) => (
    <button
      type="button"
      onClick={() => void updates().open('release')}
      className="cursor-pointer self-start text-sm font-medium text-accent"
    >
      {label}
    </button>
  );

  if (!notes)
    return (
      <p className="text-sm text-muted">
        {query.isLoading ? 'Getting the release notes…' : 'No details yet.'}
      </p>
    );
  if (notes.source === 'failed')
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">Couldn't load the notes.</p>
        {link('See them on GitHub')}
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {showVersion && (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">Version {notes.version}</span>
          {notes.date && (
            <span className="text-sm text-muted">
              Released {longDate(notes.date)}
            </span>
          )}
        </span>
      )}
      {notes.sections.length === 0 && (
        <p className="text-sm text-muted">
          No details were written for this version.
        </p>
      )}
      {notes.sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          {section.title && (
            <h3 className="text-[0.8667rem] font-semibold text-muted">
              {section.title}
            </h3>
          )}
          <ul className="list-disc pl-[18px] text-sm leading-relaxed">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      {link('Full release notes on GitHub')}
    </div>
  );
}

const PENDING: UpdateStatus['state'][] = [
  'available',
  'downloading',
  'downloaded',
  'installing',
  'manual',
];

/** DESIGN.md › Settings › About: checking, restarting and what each version brought. */
export function UpdatesSection() {
  const status = useUpdateStatus().data;
  const settings = useSettings().data;
  const update = useUpdateSettings();
  if (!status || !settings) return null;
  const { title, hint, danger } = describe(status);
  const pending = PENDING.includes(status.state) && !!status.version;

  return (
    <>
      <Group title="Updates">
        <div data-setting="checkUpdates">
          <div className="flex min-h-16 flex-wrap items-center gap-4 px-4 py-1">
            {status.state === 'downloading' && (
              <span className="relative block size-6 shrink-0" aria-hidden>
                <WaveRing value={(status.progress ?? 0) / 100} live />
              </span>
            )}
            <span className="flex min-w-60 flex-1 flex-col gap-0.5">
              <span className="font-medium">{title}</span>
              <span
                className={`text-sm tabular-nums ${danger ? 'text-danger' : 'text-muted'}`}
              >
                {hint}
              </span>
            </span>
            <Action status={status} />
          </div>
          {pending && (
            <div className="px-4 pt-1 pb-4">
              <ReleaseDetails target="pending" version={status.version} />
            </div>
          )}
        </div>
        <SettingSwitch
          id="autoUpdate"
          isSelected={settings.autoUpdate}
          onChange={(autoUpdate) => update.mutate({ autoUpdate })}
        />
      </Group>
      <Group title="What's new" anchor="whatsNew">
        <div className="p-4">
          <ReleaseDetails
            target="installed"
            version={status.currentVersion}
            showVersion
          />
        </div>
      </Group>
    </>
  );
}
