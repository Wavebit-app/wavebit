import { Alert, ProgressBar, toast } from '@heroui/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUpToLine,
  CircleX,
  Disc3,
  FolderCog,
  FolderOpen,
  ListX,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  DownloadFailure,
  DownloadJob,
  DownloadsSummary,
} from '../../../shared/schemas/downloads';
import { nav } from '../../app/router';
import { setUi, useUi } from '../../app/ui';
import { menuOn, type MenuSpec } from '../../design/ContextMenu';
import { Empty } from '../../design/Empty';
import { IconAction } from '../../design/IconAction';
import { SideOrBottomSheet } from '../../design/Sheet';
import { StatusArt } from '../../design/StatusArt';
import { useSizeClass } from '../../lib/useBreakpoint';
import { player } from '../player/player';
import { syncDownloadedLists } from './lists';
import { Tick } from './SongArt';
import { connectDownloads, useDownloadJobs, useDownloadSummary } from './store';

const api = () => window.wavebit.downloads;
const ROW_HEIGHT = 92;

export const REASONS: Record<DownloadFailure, string> = {
  age_restricted: 'Age-restricted on YouTube',
  restricted: 'Needs a YouTube account or membership',
  unavailable: 'Not available on YouTube',
  no_format: 'YouTube has no audio to save for this song',
  no_match: 'Couldn’t find this song on YouTube Music',
  network: 'Check your connection and try again',
  outdated: 'Downloader needs an update',
  missing_tools: 'Downloader is missing. Reinstall wavebit',
  library_full: 'Your library already has 20 folders',
  blocked: 'YouTube is limiting downloads',
  failed: 'Couldn’t download this song',
};

const isActive = (job: DownloadJob) =>
  job.state === 'queued' || job.state === 'running';

function statusLine(job: DownloadJob): string {
  if (job.state === 'failed') return REASONS[job.reason ?? 'failed'];
  if (job.state === 'done') return 'On this device';
  if (job.state === 'queued') return 'Waiting';
  return job.fraction === null
    ? 'Starting'
    : `Downloading ${Math.round(job.fraction * 100)}%`;
}

async function withTrack(
  job: DownloadJob,
  use: (found: { id: string; albumKey: string | null }) => void,
) {
  const found = await api()
    .locate(job.id)
    .catch(() => null);
  if (found) use(found);
  else toast('Still being added to your library');
}

function jobMenu(job: DownloadJob, askDelete: () => void): MenuSpec {
  const label = `Actions for ${job.title}`;
  if (isActive(job))
    return {
      label,
      sections: [
        [
          ...(job.state === 'queued'
            ? [
                {
                  id: 'next',
                  label: 'Download next',
                  icon: ArrowUpToLine,
                  run: () => void api().moveToTop(job.id),
                },
              ]
            : []),
          {
            id: 'cancel',
            label: 'Cancel',
            icon: X,
            run: () => void api().cancel(job.id),
          },
        ],
      ],
    };
  if (job.state === 'failed')
    return {
      label,
      sections: [
        [
          {
            id: 'retry',
            label: 'Retry',
            icon: RotateCcw,
            run: () => void api().retry(job.id),
          },
          {
            id: 'remove',
            label: 'Remove',
            icon: ListX,
            run: () => void api().remove(job.id),
          },
        ],
      ],
    };
  return {
    label,
    sections: [
      [
        {
          id: 'play',
          label: 'Play',
          icon: Play,
          run: () =>
            void withTrack(job, ({ id, albumKey }) => {
              player.playList(
                [
                  {
                    id,
                    title: job.title,
                    artist: job.artist,
                    album: job.album,
                    albumKey,
                    artwork: job.artwork,
                    durationMs: job.durationMs,
                  },
                ],
                0,
                job.title,
              );
            }),
        },
        {
          id: 'folder',
          label: 'Show in folder',
          icon: FolderOpen,
          run: () => void api().showInFolder(job.id),
        },
        {
          id: 'album',
          label: 'Go to album',
          icon: Disc3,
          run: () =>
            void withTrack(job, ({ albumKey }) => {
              if (!albumKey) {
                toast('This song has no album');
                return;
              }
              setUi({ downloads: false });
              nav.go({ name: 'album', key: albumKey });
            }),
        },
      ],
      [
        {
          id: 'remove',
          label: 'Remove from list',
          icon: ListX,
          run: () => void api().remove(job.id),
        },
        {
          id: 'delete',
          label: 'Delete file',
          icon: Trash2,
          run: askDelete,
          danger: true,
        },
      ],
    ],
  };
}

function JobRow({
  job,
  onDelete,
}: {
  job: DownloadJob;
  onDelete: (job: DownloadJob) => void;
}) {
  const failed = job.state === 'failed';
  const subtitle = [job.artist, job.from ?? job.album]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      onContextMenu={menuOn(() => jobMenu(job, () => onDelete(job)))}
      className="flex h-[88px] items-center gap-3 rounded-md px-1 hover:bg-sunken"
    >
      <StatusArt
        status={job.state}
        fraction={job.fraction ?? 0}
        src={job.artwork}
        size={56}
        rounded="rounded-md"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">
            {job.title}
          </p>
          {job.state === 'done' && <Tick />}
        </div>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        <p className="truncate text-xs text-muted" title={job.fileName}>
          {job.fileName}
        </p>
        <p
          className={`truncate text-xs tabular-nums ${failed ? 'text-danger' : job.state === 'done' ? 'text-success' : 'text-muted'}`}
        >
          {statusLine(job)}
        </p>
      </div>
      {isActive(job) ? (
        <IconAction
          label={`Cancel ${job.title}`}
          size={44}
          onPress={() => void api().cancel(job.id)}
        >
          <X size={24} aria-hidden />
        </IconAction>
      ) : failed ? (
        <IconAction
          label={`Retry ${job.title}`}
          size={44}
          onPress={() => void api().retry(job.id)}
        >
          <RotateCcw size={24} aria-hidden />
        </IconAction>
      ) : null}
    </div>
  );
}

function JobList({ onDelete }: { onDelete: (job: DownloadJob) => void }) {
  const jobs = useDownloadJobs();
  const compact = useSizeClass() === 'compact';
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });
  return (
    // The side drawer has a height to fill; a bottom sheet takes its height from this.
    <div
      ref={scroller}
      className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      style={compact ? { height: '55vh', flex: 'none' } : undefined}
    >
      <div className="relative" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => (
          <div
            key={jobs[row.index]!.id}
            className="absolute inset-x-0"
            style={{ top: row.start }}
          >
            <JobRow job={jobs[row.index]!} onDelete={onDelete} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Large bare icons, always in the same places; one that can't be used now dims. */
function Tools({ s }: { s: DownloadsSummary }) {
  const paused = s.pause !== null;
  return (
    <div
      role="toolbar"
      aria-label="Download controls"
      className="flex shrink-0 items-center justify-between"
    >
      <IconAction
        label={paused ? 'Resume' : 'Pause'}
        size={60}
        active={paused}
        isDisabled={s.active === 0}
        onPress={() => void (paused ? api().resume() : api().pause())}
      >
        {paused ? (
          <Play size={36} aria-hidden />
        ) : (
          <Pause size={36} aria-hidden />
        )}
      </IconAction>
      <IconAction
        label="Cancel all"
        size={60}
        isDisabled={s.active === 0}
        onPress={() => void api().cancelAll()}
      >
        <CircleX size={36} aria-hidden />
      </IconAction>
      <IconAction
        label="Retry failed"
        size={60}
        isDisabled={s.failed === 0}
        onPress={() => void api().retryFailed()}
      >
        <RotateCcw size={36} aria-hidden />
      </IconAction>
      <IconAction
        label="Clear finished"
        size={60}
        isDisabled={s.done + s.failed === 0}
        onPress={() => void api().clear()}
      >
        <ListX size={36} aria-hidden />
      </IconAction>
    </div>
  );
}

function Body() {
  const s = useDownloadSummary();
  const [deleting, setDeleting] = useState<DownloadJob | null>(null);
  const settled = s.done + s.failed;
  const percent = Math.round(s.fraction * 100);
  const until =
    s.waitingUntil &&
    new Date(s.waitingUntil).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

  const confirmDelete = async (job: DownloadJob) => {
    setDeleting(null);
    try {
      await api().delete(job.id);
      toast(`“${job.title}” moved to the Trash`);
    } catch {
      toast(`Couldn’t delete “${job.title}”`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pt-2">
      {s.total > 0 && (
        <ProgressBar
          aria-label="All downloads"
          className="shrink-0 gap-1.5"
          value={percent}
        >
          <span className="text-sm text-muted tabular-nums">
            {settled.toLocaleString()} of {s.total.toLocaleString()} · {percent}
            %
          </span>
          <ProgressBar.Track className="h-1">
            <ProgressBar.Fill className="bg-accent" />
          </ProgressBar.Track>
        </ProgressBar>
      )}
      <Tools s={s} />
      {s.pause === 'blocked' && (
        <Alert status="warning" className="shrink-0">
          <Alert.Content>
            <Alert.Title>YouTube is limiting downloads</Alert.Title>
            <Alert.Description>
              The rest are waiting. Press Resume in a while.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {until && (
        <Alert status="accent" className="shrink-0">
          <Alert.Content>
            <Alert.Title>Waiting for YouTube</Alert.Title>
            <Alert.Description>
              wavebit starts 250 songs an hour so YouTube doesn’t block you. The
              next one starts at {until}.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {deleting && (
        <Alert status="danger" className="shrink-0 items-center">
          <Alert.Content>
            <Alert.Title>Delete “{deleting.title}”?</Alert.Title>
            <Alert.Description>
              It goes to the Trash, and you can download it again.
            </Alert.Description>
          </Alert.Content>
          <div className="flex shrink-0">
            <IconAction
              label="Move to Trash"
              size={44}
              className="text-danger!"
              onPress={() => void confirmDelete(deleting)}
            >
              <Trash2 size={24} aria-hidden />
            </IconAction>
            <IconAction
              label="Keep the file"
              size={44}
              onPress={() => setDeleting(null)}
            >
              <X size={24} aria-hidden />
            </IconAction>
          </div>
        </Alert>
      )}
      {s.total > 0 ? (
        <JobList onDelete={setDeleting} />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Empty art="folder" title="Nothing downloading" size={96}>
            Songs you download appear here.
          </Empty>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate text-xs text-muted"
          title={s.folder}
        >
          Saved to {s.folder}
        </p>
        <IconAction
          label="Download settings"
          size={44}
          onPress={() => {
            setUi({ downloads: false });
            nav.go({ name: 'settings', section: 'downloads' });
          }}
        >
          <FolderCog size={24} aria-hidden />
        </IconAction>
      </div>
    </div>
  );
}

/** Downloads, opened from the title bar (DESIGN.md › Downloads). */
export function DownloadsSheet() {
  const open = useUi((s) => s.downloads);

  useEffect(() => {
    const { stop, ready } = connectDownloads();
    void ready
      .then(async () => {
        const settings = await window.wavebit.settings.get();
        if (settings.downloadSyncLists) await syncDownloadedLists();
      })
      .catch(() => {});
    return stop;
  }, []);

  return (
    <SideOrBottomSheet
      isOpen={open}
      onOpenChange={(downloads) => setUi({ downloads })}
      title="Downloads"
      fit
    >
      <Body />
    </SideOrBottomSheet>
  );
}
