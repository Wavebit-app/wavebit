import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, shell, type BrowserWindow } from 'electron';
import { AppError } from '../../shared/errors';
import { Events } from '../../shared/ipc/channels';
import {
  downloadKey,
  type ChooseDownloadFolderResult,
  type DownloadAddResult,
  type DownloadedLibrary,
  type DownloadFailure,
  type DownloadJob,
  type DownloadList,
  type DownloadLocation,
  type DownloadsState,
  type DownloadsSummary,
  type DownloadSong,
} from '../../shared/schemas/downloads';
import { emit } from '../ipc/handle';
import {
  lib,
  libraryState,
  MAX_FOLDERS,
  pickFolder,
  scan,
} from '../library/library';
import { lrclib } from '../lyrics/lrclib';
import { artUrlFromPath } from '../security/urls';
import { cachedImage } from '../services/artCache';
import { native } from '../services/native';
import { readSettings, writeSettings } from '../services/settings';
import { match } from '../youtube/service';
import {
  canEmbedCover,
  failureOf,
  insideFolder,
  isM4a,
  lyricsText,
  msUntilStart,
  parseProgress,
  recentStarts,
  songFileName,
  songLocation,
  ytDlpArgs,
} from './downloadRules';
import {
  loadStored,
  saveStored,
  saveStoredNow,
  type StoredDownloads,
} from './downloadStore';

const JOB_TIMEOUT_MS = 10 * 60_000;
const EMIT_MS = 250;
const SAVE_MS = 1_000;
const SCAN_DELAY_MS = 3_000;
const MAX_JOBS = 20_000;
const STDERR_TAIL = 16 * 1024;
const REMOTE_ART = 'media://remote/';
/** Only what a program needs to start and to reach a network through a proxy. */
const PASSED_ENV = [
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

class DownloadError extends Error {
  constructor(readonly reason: DownloadFailure) {
    super(reason);
  }
}

interface Job {
  info: DownloadJob;
  song: DownloadSong;
  list: DownloadList | null;
  child: ChildProcess | null;
  cancelled: boolean;
  /** It holds its video: another job for that video waits for it. */
  claimed: boolean;
  finished: Promise<void> | null;
}

const jobs = new Map<string, Job>();
let stored: StoredDownloads = {
  records: Object.create(null),
  queue: [],
  lists: [],
  starts: [],
};
let pause: DownloadsSummary['pause'] = null;
let running = 0;
let firstOrder = 0;
let lastOrder = 0;
let waitingUntil: number | null = null;
let limitTimer: NodeJS.Timeout | undefined;
let emitTimer: NodeJS.Timeout | undefined;
let saveTimer: NodeJS.Timeout | undefined;
let scanTimer: NodeJS.Timeout | undefined;
/** Quitting or updating: the queue is saved, so nothing may start or overwrite it. */
let stopping = false;
const STOP_WAIT_MS = 3000;
/** One file is moved into place at a time, so two songs can't take one name. */
let publishing: Promise<unknown> = Promise.resolve();

const dirty = new Set<string>();
const removed = new Set<string>();
const savedAdded = new Set<string>();
const savedRemoved = new Set<string>();

const userPath = (name: string) => path.join(app.getPath('userData'), name);
const tempRoot = () => userPath('downloads-tmp');
const storeFile = () => userPath('downloads.json');
const isActive = (j: Job) =>
  j.info.state === 'queued' || j.info.state === 'running';

/** Beside the Rust addon when packaged, in the project in dev (services/native.ts). */
function tool(name: string): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(app.getAppPath(), 'tools');
  return path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
}

const currentFolder = () =>
  readSettings().downloadFolder ?? path.join(app.getPath('music'), 'wavebit');

const pathExists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

// --- What the page is told ---------------------------------------------------

function summary(): DownloadsSummary {
  let done = 0;
  let failed = 0;
  let active = 0;
  let progress = 0;
  for (const { info } of jobs.values()) {
    if (info.state === 'done') {
      done++;
      progress++;
    } else if (info.state === 'failed') {
      failed++;
      progress++;
    } else {
      active++;
      if (info.state === 'running') progress += info.fraction ?? 0;
    }
  }
  return {
    folder: currentFolder(),
    total: jobs.size,
    done,
    failed,
    active,
    fraction: jobs.size ? progress / jobs.size : 0,
    pause,
    waitingUntil,
  };
}

const savedKeys = () =>
  Object.entries(stored.records).flatMap(([id, r]) => [id, ...r.keys]);

export function downloadsState(): DownloadsState {
  return {
    summary: summary(),
    jobs: [...jobs.values()].map((j) => j.info),
    saved: savedKeys(),
    lists: stored.lists,
  };
}

function flush(): void {
  emitTimer = undefined;
  emit(Events.downloadsChanged, {
    summary: summary(),
    jobs: [...dirty].flatMap((id) => {
      const job = jobs.get(id);
      return job ? [job.info] : [];
    }),
    removed: [...removed],
    savedAdded: [...savedAdded],
    savedRemoved: [...savedRemoved],
  });
  dirty.clear();
  removed.clear();
  savedAdded.clear();
  savedRemoved.clear();
}

function changed(job?: Job): void {
  if (job) dirty.add(job.info.id);
  emitTimer ??= setTimeout(flush, EMIT_MS);
}

function snapshot(): StoredDownloads {
  return {
    ...stored,
    queue: [...jobs.values()]
      .filter(isActive)
      .sort((a, b) => a.info.order - b.info.order)
      .map((j) => ({ song: j.song, list: j.list })),
  };
}

function saveSoon(): void {
  if (stopping) return;
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    saveStored(storeFile(), snapshot()).catch((error: unknown) =>
      console.error('downloads: could not save', error),
    );
  }, SAVE_MS);
}

/** Waits out a scan in progress: one that has passed this folder would miss the file. */
function scanSoon(): void {
  scanTimer ??= setTimeout(() => {
    scanTimer = undefined;
    if (libraryState().scanning) scanSoon();
    else void scan().catch(() => {});
  }, SCAN_DELAY_MS);
}

// --- The record of finished songs ---------------------------------------------

function videoOfKey(key: string): string | null {
  if (stored.records[key]) return key;
  for (const [id, record] of Object.entries(stored.records))
    if (record.keys.includes(key)) return id;
  return null;
}

function forget(videoId: string): void {
  const record = stored.records[videoId];
  if (!record) return;
  for (const key of [videoId, ...record.keys]) {
    savedRemoved.add(key);
    savedAdded.delete(key);
  }
  delete stored.records[videoId];
  saveSoon();
  changed();
}

/** Whether a song is saved and its file is still there; a missing file clears it. */
async function isSaved(key: string): Promise<boolean> {
  const videoId = videoOfKey(key);
  const record = videoId && stored.records[videoId];
  if (!videoId || !record) return false;
  if (await pathExists(record.file)) return true;
  forget(videoId);
  return false;
}

function remember(job: Job, videoId: string, file: string): void {
  const keys = job.info.key === videoId ? [] : [job.info.key];
  stored.records[videoId] = {
    file,
    title: job.song.title,
    artist: job.song.artist,
    addedAt: Date.now(),
    keys,
  };
  for (const key of [videoId, ...keys]) {
    savedAdded.add(key);
    savedRemoved.delete(key);
  }
  saveSoon();
}

// --- One download --------------------------------------------------------------

/** The folder, made if need be and read by the library. */
async function readyFolder(): Promise<string> {
  const folder = currentFolder();
  await fs.mkdir(folder, { recursive: true });
  const real = await fs.realpath(folder);
  const { libraryFolders } = readSettings();
  if (!libraryFolders.some((f) => real === f || insideFolder(f, real))) {
    if (libraryFolders.length >= MAX_FOLDERS)
      throw new DownloadError('library_full');
    writeSettings({ libraryFolders: [...libraryFolders, real] });
  }
  return real;
}

async function videoIdOf(song: DownloadSong): Promise<string> {
  if (song.videoId) return song.videoId;
  try {
    const found = song.match && (await match(song.match));
    if (found) return found.videoId;
  } catch (error) {
    if (error instanceof AppError && error.code === 'rate_limited')
      throw new DownloadError('blocked');
    throw new DownloadError('network');
  }
  throw new DownloadError('no_match');
}

function runYtDlp(job: Job, videoId: string, cwd: string): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    PATH: '',
    HOME: userPath('yt-dlp-home'),
    DENO_NO_UPDATE_CHECK: '1',
  };
  for (const name of PASSED_ENV)
    if (process.env[name]) env[name] = process.env[name];

  return new Promise((resolve, reject) => {
    const child = spawn(
      tool('yt-dlp'),
      ytDlpArgs({
        videoId,
        denoPath: tool('deno'),
        cacheDir: userPath('yt-dlp-cache'),
      }),
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    job.child = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, JOB_TIMEOUT_MS);

    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        const fraction = parseProgress(line.trim());
        if (fraction !== null) {
          job.info.fraction = fraction;
          changed(job);
        }
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });

    child.on('error', () => {
      clearTimeout(timer);
      reject(new DownloadError('missing_tools'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new DownloadError(timedOut ? 'network' : failureOf(stderr)));
    });
  });
}

/** The one file yt-dlp left, checked by what it holds. */
async function outputFile(dir: string): Promise<string> {
  const [name, ...others] = (await fs.readdir(dir)).filter((n) =>
    n.endsWith('.m4a'),
  );
  if (!name || others.length) throw new DownloadError('failed');
  const file = path.join(dir, name);
  const handle = await fs.open(file, 'r');
  try {
    const head = new Uint8Array(12);
    await handle.read(head, 0, head.length, 0);
    if (!isM4a(head)) throw new DownloadError('failed');
  } finally {
    await handle.close();
  }
  return file;
}

/** A cover only from the artwork hosts media://remote serves (security/urls.ts). */
async function coverOf(song: DownloadSong) {
  const art = song.artwork;
  if (!art) return null;
  const encoded = art.startsWith(REMOTE_ART)
    ? art.slice(REMOTE_ART.length)
    : Buffer.from(art).toString('base64url');
  const url = artUrlFromPath(encoded);
  const image = url ? await cachedImage(url) : null;
  return image && canEmbedCover(image.mime) ? image : null;
}

/** Words are a bonus: a song is still saved without them. */
async function lyricsOf(song: DownloadSong): Promise<string | undefined> {
  try {
    const found = await lrclib({
      title: song.title,
      artist: song.artist,
      album: song.album,
      durationMs: song.durationMs,
    });
    return (found && lyricsText(found)) || undefined;
  } catch {
    return undefined;
  }
}

async function writeTags(file: string, song: DownloadSong): Promise<void> {
  const { downloadEmbedCover, downloadEmbedLyrics } = readSettings();
  const [cover, lyrics] = await Promise.all([
    downloadEmbedCover ? coverOf(song) : null,
    downloadEmbedLyrics ? lyricsOf(song) : undefined,
  ]);
  native().writeTags(file, {
    title: song.title,
    artist: song.artist || 'Unknown artist',
    album: song.album || undefined,
    cover: cover?.data,
    coverMime: cover?.mime,
    lyrics,
  });
}

async function moveIntoPlace(
  file: string,
  song: DownloadSong,
  videoId: string,
): Promise<string> {
  const folder = await readyFolder();
  const { dirs, name } = songLocation({
    artist: song.artist,
    album: song.album,
    title: song.title,
    videoId,
    organise: readSettings().downloadOrganise,
  });
  const parent = path.join(folder, ...dirs);
  let target = path.join(parent, name);
  if (await pathExists(target))
    target = path.join(parent, name.replace(/\.m4a$/, ` (${videoId}).m4a`));
  if (!insideFolder(folder, target)) throw new DownloadError('failed');
  await fs.mkdir(parent, { recursive: true });
  // A name the scanner skips until the whole file is there; the temp folder
  // can be on another disk, so a plain rename wouldn't do.
  const part = path.join(parent, `.${videoId}.part`);
  await fs.copyFile(file, part);
  await fs.rename(part, target);
  return target;
}

/** Two pages can reach one video under different keys: the later one waits. */
async function waitForTwin(job: Job, videoId: string): Promise<void> {
  for (;;) {
    const twin = [...jobs.values()].find(
      (j) => j !== job && j.claimed && j.info.videoId === videoId,
    );
    if (!twin?.finished) {
      job.claimed = true;
      return;
    }
    await twin.finished;
  }
}

function finish(job: Job, file: string): void {
  job.info.state = 'done';
  job.info.fraction = 1;
  job.info.reason = null;
  job.info.fileName = path.basename(file);
}

async function run(job: Job): Promise<void> {
  const dir = path.join(tempRoot(), job.info.id);
  try {
    await fs.mkdir(dir, { recursive: true });
    const videoId = await videoIdOf(job.song);
    job.info.videoId = videoId;
    changed(job);
    await waitForTwin(job, videoId);
    if (job.cancelled) return;

    // The duplicate check again, now that a Spotify song has a video.
    if (await isSaved(videoId)) {
      const record = stored.records[videoId]!;
      if (job.info.key !== videoId && !record.keys.includes(job.info.key)) {
        record.keys.push(job.info.key);
        savedAdded.add(job.info.key);
        saveSoon();
      }
      finish(job, record.file);
      return;
    }

    await runYtDlp(job, videoId, dir);
    if (job.cancelled) return;
    const file = await outputFile(dir);
    await writeTags(file, job.song);
    if (job.cancelled) return;
    const place = publishing.then(() => moveIntoPlace(file, job.song, videoId));
    publishing = place.catch(() => {});
    const target = await place;
    remember(job, videoId, target);
    finish(job, target);
    scanSoon();
  } catch (error) {
    if (job.cancelled) return;
    const reason = error instanceof DownloadError ? error.reason : 'failed';
    if (reason === 'blocked') {
      // The song did nothing wrong: it waits for Resume with the rest.
      pause = 'blocked';
      job.info.state = 'queued';
      job.info.fraction = null;
      return;
    }
    if (reason === 'failed') console.error('downloads: failed', error);
    job.info.state = 'failed';
    job.info.reason = reason;
  } finally {
    job.child = null;
    job.claimed = false;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function start(job: Job): void {
  running++;
  job.info.state = 'running';
  job.finished = run(job).finally(() => {
    running--;
    job.finished = null;
    changed(job);
    saveSoon();
    pump();
  });
}

function pump(): void {
  if (stopping) return;
  clearTimeout(limitTimer);
  waitingUntil = null;
  if (!pause) {
    const limit = readSettings().downloadConcurrency;
    const waiting = [...jobs.values()]
      .filter((j) => j.info.state === 'queued')
      .sort((a, b) => a.info.order - b.info.order);
    const now = Date.now();
    stored.starts = recentStarts(stored.starts, now);
    for (const job of waiting) {
      if (running >= limit) break;
      const wait = msUntilStart(stored.starts, now);
      if (wait > 0) {
        waitingUntil = now + wait;
        limitTimer = setTimeout(pump, wait);
        break;
      }
      stored.starts.push(now);
      start(job);
      changed(job);
    }
  }
  changed();
  saveSoon();
}

// --- What the page can ask for -------------------------------------------------

function createJob(song: DownloadSong, list: DownloadList | null): void {
  const id = randomUUID();
  jobs.set(id, {
    song,
    list,
    child: null,
    cancelled: false,
    claimed: false,
    finished: null,
    info: {
      id,
      key: downloadKey(song),
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.artwork,
      durationMs: song.durationMs,
      from: list?.title ?? null,
      fileName: songFileName(song.artist, song.title, song.videoId ?? 'song'),
      state: 'queued',
      fraction: null,
      reason: null,
      order: ++lastOrder,
    },
  });
  dirty.add(id);
}

export async function addDownloads(
  songs: DownloadSong[],
  list: DownloadList | null,
): Promise<DownloadAddResult> {
  const saved = await Promise.all(songs.map((s) => isSaved(downloadKey(s))));
  const owned = readSettings().downloadSkipOwned
    ? lib().matchTracks(
        songs.map((s) => ({
          title: s.title,
          artists: s.artist.split(/,\s*|\s+&\s+/).filter(Boolean),
          durationMs: s.durationMs,
        })),
      )
    : [];
  // After the checks above have awaited, so two quick calls can't both pass.
  const active = new Set(
    [...jobs.values()]
      .filter(isActive)
      .flatMap((j) => [j.info.key, j.info.videoId ?? j.info.key]),
  );
  if (
    list &&
    !stored.lists.some((l) => l.kind === list.kind && l.id === list.id)
  )
    stored.lists.push(list);
  let added = 0;
  songs.forEach((song, i) => {
    const key = downloadKey(song);
    if (saved[i] || owned[i] || active.has(key) || jobs.size >= MAX_JOBS)
      return;
    active.add(key);
    createJob(song, list);
    added++;
  });
  pump();
  return { added, skipped: songs.length - added };
}

function drop(id: string): void {
  jobs.delete(id);
  dirty.delete(id);
  removed.add(id);
}

export function cancelDownload(id: string): void {
  const job = jobs.get(id);
  if (!job || !isActive(job)) return;
  job.cancelled = true;
  job.child?.kill();
  drop(id);
  pump();
}

export function cancelAllDownloads(): void {
  for (const [id, job] of jobs) {
    if (!isActive(job)) continue;
    job.cancelled = true;
    job.child?.kill();
    drop(id);
  }
  pump();
}

/** Takes a finished or failed song off the list; its file stays. */
export function removeDownload(id: string): void {
  const job = jobs.get(id);
  if (!job || isActive(job)) return;
  drop(id);
  changed();
}

export function clearFinishedDownloads(): void {
  for (const [id, job] of jobs) if (!isActive(job)) drop(id);
  changed();
}

function retry(job: Job): void {
  job.info.state = 'queued';
  job.info.fraction = null;
  job.info.reason = null;
  changed(job);
}

export function retryDownload(id: string): void {
  const job = jobs.get(id);
  if (job?.info.state === 'failed') retry(job);
  pump();
}

export function retryFailedDownloads(): void {
  for (const job of jobs.values()) if (job.info.state === 'failed') retry(job);
  pump();
}

export function moveDownloadToTop(id: string): void {
  const job = jobs.get(id);
  if (!job || job.info.state !== 'queued') return;
  job.info.order = --firstOrder;
  changed(job);
  saveSoon();
}

export function pauseDownloads(): void {
  pause = 'user';
  pump();
}

export function resumeDownloads(): void {
  pause = null;
  pump();
}

/**
 * The file of a finished song, or null. The page names a job; the path comes
 * from wavebit's own record and must still be inside a folder the library reads.
 */
function ownedFile(id: string): { videoId: string; file: string } | null {
  const videoId = jobs.get(id)?.info.videoId;
  const record = videoId ? stored.records[videoId] : undefined;
  if (!videoId || !record) return null;
  const roots = [currentFolder(), ...readSettings().libraryFolders];
  return roots.some((root) => insideFolder(root, record.file))
    ? { videoId, file: record.file }
    : null;
}

export function showDownloadInFolder(id: string): void {
  const owned = ownedFile(id);
  if (owned) shell.showItemInFolder(owned.file);
}

/** Library › Downloads: survives Clear finished, since it reads the records. */
export function downloadedLibrary(): DownloadedLibrary {
  const files = Object.values(stored.records)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((record) => record.file);
  return { tracks: lib().tracksByPaths(files), lists: stored.lists };
}

export async function openDownloadFolder(): Promise<void> {
  const folder = currentFolder();
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
}

export function locateDownload(id: string): DownloadLocation | null {
  const owned = ownedFile(id);
  const found = owned ? lib().trackByPath(owned.file) : null;
  return found ? { id: found.id, albumKey: found.albumKey ?? null } : null;
}

/** To the Trash, so a wrong click can be undone. */
export async function deleteDownload(id: string): Promise<void> {
  const owned = ownedFile(id);
  if (!owned) throw new AppError('failed');
  await shell.trashItem(owned.file);
  forget(owned.videoId);
  drop(id);
  changed();
  scanSoon();
}

/** The same, from the Library: the page names a track, and only a saved one counts. */
export async function deleteDownloadedTrack(trackId: string): Promise<void> {
  const file = lib().trackPath(trackId);
  const saved = Object.entries(stored.records).find(
    ([, record]) => record.file === file,
  );
  if (!file || !saved) throw new AppError('failed');
  await shell.trashItem(file);
  forget(saved[0]);
  for (const [id, job] of jobs)
    if (job.info.videoId === saved[0] && !isActive(job)) drop(id);
  changed();
  scanSoon();
}

export async function chooseDownloadFolder(
  win: BrowserWindow | null,
): Promise<ChooseDownloadFolderResult> {
  const picked = await pickFolder(win, 'Choose a download folder');
  if (!picked.ok) return picked;
  const { libraryFolders } = readSettings();
  if (
    !libraryFolders.some(
      (f) => picked.folder === f || insideFolder(f, picked.folder),
    ) &&
    libraryFolders.length >= MAX_FOLDERS
  )
    return { ok: false, reason: 'limit' };
  writeSettings({ downloadFolder: picked.folder });
  await readyFolder();
  void scan().catch(() => {});
  changed();
  return { ok: true };
}

/** Files deleted while wavebit was closed stop counting as saved. */
async function pruneMissing(): Promise<void> {
  await Promise.all(Object.keys(stored.records).map((id) => isSaved(id)));
}

export function startDownloads(): void {
  stored = loadStored(storeFile());
  for (const { song, list } of stored.queue) createJob(song, list);
  void pruneMissing();
  // Whatever a crash or a forced quit left behind, cleared before anything
  // starts: a restored download works inside this folder.
  void fs
    .rm(tempRoot(), { recursive: true, force: true })
    .catch(() => {})
    .finally(pump);
  app.on('before-quit', stopAll);
}

/** yt-dlp starts Deno and more; on Windows a survivor would lock its .exe. */
function killTree(child: ChildProcess): void {
  if (process.platform !== 'win32' || !child.pid) {
    child.kill();
    return;
  }
  const taskkill = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'taskkill.exe',
  );
  spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
  });
}

function stopAll(): ChildProcess[] {
  if (stopping) return [];
  stopping = true;
  // Saved first: the unfinished songs are the queue for next time.
  clearTimeout(saveTimer);
  clearTimeout(limitTimer);
  try {
    saveStoredNow(storeFile(), snapshot());
  } catch (error) {
    console.error('downloads: could not save', error);
  }
  const children: ChildProcess[] = [];
  for (const job of jobs.values()) {
    job.cancelled = true;
    if (job.child && job.child.exitCode === null) {
      children.push(job.child);
      killTree(job.child);
    }
  }
  return children;
}

/** Before an update installs: nothing may still be running from the old version. */
export async function stopDownloadsForUpdate(): Promise<void> {
  const children = stopAll();
  await Promise.race([
    Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => child.once('close', () => resolve())),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS)),
  ]);
}
