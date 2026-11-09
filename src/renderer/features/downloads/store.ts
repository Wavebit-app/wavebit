import { useMemo, useSyncExternalStore } from 'react';
import { Events } from '../../../shared/ipc/channels';
import {
  downloadKey,
  type DownloadFailure,
  type DownloadJob,
  type DownloadList,
  type DownloadsDelta,
  type DownloadsState,
  type DownloadsSummary,
} from '../../../shared/schemas/downloads';
import type { ArtStatus } from '../../design/StatusArt';
import { isFile, type Playable } from '../player/player';

export interface SongStatus {
  state: ArtStatus;
  fraction: number;
  reason: DownloadFailure | null;
}

const IDLE: SongStatus = { state: 'idle', fraction: 0, reason: null };
const ON_DEVICE: SongStatus = { state: 'done', fraction: 1, reason: null };
const EMPTY_SUMMARY: DownloadsSummary = {
  folder: '',
  total: 0,
  done: 0,
  failed: 0,
  active: 0,
  fraction: 0,
  pause: null,
  waitingUntil: null,
};

const jobs = new Map<string, DownloadJob>();
const byKey = new Map<string, DownloadJob>();
const saved = new Set<string>();
const statuses = new Map<string, SongStatus>();
const keyListeners = new Map<string, Set<() => void>>();
const listeners = new Set<() => void>();
let summary = EMPTY_SUMMARY;
let lists: DownloadList[] = [];
let version = 0;
let sorted: DownloadJob[] = [];
let sortedAt = -1;

const isActive = (job: DownloadJob) =>
  job.state === 'queued' || job.state === 'running';

const keysOf = (job: DownloadJob) =>
  job.videoId && job.videoId !== job.key ? [job.key, job.videoId] : [job.key];

function compute(key: string): SongStatus {
  const job = byKey.get(key);
  if (job && isActive(job))
    return {
      state: job.state === 'running' ? 'running' : 'queued',
      fraction: job.fraction ?? 0,
      reason: null,
    };
  if (saved.has(key) || job?.state === 'done') return ON_DEVICE;
  if (job?.state === 'failed')
    return { state: 'failed', fraction: 0, reason: job.reason };
  return IDLE;
}

function statusOf(key: string): SongStatus {
  let status = statuses.get(key);
  if (!status) {
    status = compute(key);
    statuses.set(key, status);
  }
  return status;
}

function index(job: DownloadJob, touched: Set<string>): void {
  for (const key of keysOf(job)) {
    const held = byKey.get(key);
    // A song being downloaded again outranks its older finished row.
    if (!held || held.id === job.id || isActive(job) || !isActive(held))
      byKey.set(key, job);
    touched.add(key);
  }
}

function unindex(job: DownloadJob, touched: Set<string>): void {
  for (const key of keysOf(job)) {
    if (byKey.get(key)?.id === job.id) byKey.delete(key);
    touched.add(key);
  }
}

function publish(touched: Set<string>): void {
  version++;
  for (const key of touched) {
    statuses.delete(key);
    keyListeners.get(key)?.forEach((l) => l());
  }
  listeners.forEach((l) => l());
}

function load(state: DownloadsState): void {
  const touched = new Set<string>([...byKey.keys(), ...saved]);
  jobs.clear();
  byKey.clear();
  saved.clear();
  for (const key of state.saved) {
    saved.add(key);
    touched.add(key);
  }
  for (const job of state.jobs) {
    jobs.set(job.id, job);
    index(job, touched);
  }
  summary = state.summary;
  lists = state.lists;
  publish(touched);
}

function apply(delta: DownloadsDelta): void {
  const touched = new Set<string>();
  for (const id of delta.removed) {
    const job = jobs.get(id);
    if (job) unindex(job, touched);
    jobs.delete(id);
  }
  for (const job of delta.jobs) {
    jobs.set(job.id, job);
    index(job, touched);
  }
  for (const key of delta.savedAdded) {
    saved.add(key);
    touched.add(key);
  }
  for (const key of delta.savedRemoved) {
    saved.delete(key);
    touched.add(key);
  }
  summary = delta.summary;
  publish(touched);
}

/** Connects to the main process; the snapshot comes after the subscription, so nothing is lost. */
export function connectDownloads(): {
  stop: () => void;
  ready: Promise<DownloadsState>;
} {
  const stop = window.wavebit.on(Events.downloadsChanged, apply);
  const ready = window.wavebit.downloads.state().then((state) => {
    load(state);
    return state;
  });
  return { stop, ready };
}

export const trackKey = (track: Playable): string | null =>
  track.stream
    ? downloadKey({
        videoId: track.stream.videoId,
        match: track.stream.match ?? null,
      })
    : null;

function trackStatus(track: Playable | null): SongStatus {
  if (!track) return IDLE;
  if (isFile(track.id)) return ON_DEVICE;
  const key = trackKey(track);
  return key ? statusOf(key) : IDLE;
}

const subscribeAll = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Subscribes to one song, so another song's progress doesn't redraw this row. */
export function useSongDownload(track: Playable | null): SongStatus {
  const key = track && !isFile(track.id) ? trackKey(track) : null;
  return useSyncExternalStore(
    (listener) => {
      if (!key) return () => {};
      let set = keyListeners.get(key);
      if (!set) keyListeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) keyListeners.delete(key);
      };
    },
    () => trackStatus(track),
  );
}

export const useDownloadSummary = (): DownloadsSummary =>
  useSyncExternalStore(subscribeAll, () => summary);

export const downloadLists = (): DownloadList[] => lists;

/** Every job in queue order, sorted at most once per update. */
export function useDownloadJobs(): DownloadJob[] {
  return useSyncExternalStore(subscribeAll, () => {
    if (sortedAt !== version) {
      sorted = [...jobs.values()].sort((a, b) => a.order - b.order);
      sortedAt = version;
    }
    return sorted;
  });
}

export interface ListProgress {
  busy: boolean;
  fraction: number;
  /** Every song on the page is on this device. */
  onDevice: boolean;
}

/** One album or playlist: only the songs of this list that have been asked for count. */
export function useListProgress(
  tracks: Playable[],
  complete: boolean,
): ListProgress {
  const seen = useSyncExternalStore(subscribeAll, () => version);
  return useMemo(() => {
    let busy = false;
    let asked = 0;
    let progress = 0;
    let onDevice = complete && tracks.length > 0;
    for (const track of tracks) {
      const status = trackStatus(track);
      if (status.state !== 'done') onDevice = false;
      if (status.state === 'queued' || status.state === 'running') {
        busy = true;
        asked++;
        progress += status.fraction;
      } else if (status.state === 'failed') {
        asked++;
        progress++;
      } else if (status.state === 'done' && !isFile(track.id)) {
        const key = trackKey(track);
        if (key && byKey.has(key)) {
          asked++;
          progress++;
        }
      }
    }
    return { busy, onDevice, fraction: asked ? progress / asked : 0 };
    // `seen` stands for everything in the store these songs depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, complete, seen]);
}
