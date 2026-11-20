/**
 * Keep playing offline: a private copy of each streamed song, saved quietly
 * while it plays, so it can carry on (or play again) when the connection
 * drops. The copies live in the app's own data folder, never in the library
 * or the Downloads list, and are removed oldest first past 1 GB.
 */
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, net } from 'electron';
import { Events } from '../../shared/ipc/channels';
import {
  killTree,
  outputFile,
  savedFileOf,
  spawnYtDlp,
  takeDownloadStart,
} from '../downloads/downloads';
import { VIDEO_ID } from '../downloads/downloadRules';
import { emit } from '../ipc/handle';
import { readSettings } from '../services/settings';
import {
  copyName,
  indexToJson,
  overBudget,
  parseIndex,
  type OfflineIndex,
} from './offlineRules';

/** After YouTube refuses a copy, none is asked for this long. */
const BLOCKED_MS = 60 * 60_000;
const PROBE_URL = 'https://www.youtube.com/generate_204';
const PROBE_TIMEOUT_MS = 4_000;

const root = () => path.join(app.getPath('userData'), 'offline-songs');
const indexFile = () => path.join(root(), 'index.json');
const tempDir = () => path.join(root(), 'saving');

let index: OfflineIndex = new Map();
let loaded: Promise<void> | null = null;
let saving: { videoId: string; child: ChildProcess | null } | null = null;
let blockedUntil = 0;
let stopped = false;

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      index = parseIndex(JSON.parse(await fs.readFile(indexFile(), 'utf8')));
    } catch {
      index = new Map();
    }
    // A copy cut short by a quit is never trusted.
    await fs.rm(tempDir(), { recursive: true, force: true }).catch(() => {});
  })();
  return loaded;
}

let writing: Promise<unknown> = Promise.resolve();
function saveIndex(): void {
  const json = JSON.stringify(indexToJson(index));
  writing = writing
    .then(async () => {
      await fs.mkdir(root(), { recursive: true });
      const temp = `${indexFile()}.${randomUUID()}`;
      await fs.writeFile(temp, json);
      await fs.rename(temp, indexFile());
    })
    .catch((error: unknown) => console.error('offline: index', error));
}

async function prune(keep: string): Promise<void> {
  for (const id of overBudget(index, undefined, keep)) {
    index.delete(id);
    await fs.rm(path.join(root(), copyName(id)), { force: true });
  }
}

async function save(videoId: string): Promise<void> {
  const dir = path.join(tempDir(), videoId);
  const job = { videoId, child: null as ChildProcess | null };
  saving = job;
  try {
    await fs.mkdir(dir, { recursive: true });
    await spawnYtDlp(videoId, dir, (child) => (job.child = child));
    if (saving !== job) return;
    const file = await outputFile(dir);
    const target = path.join(root(), copyName(videoId));
    await fs.rename(file, target);
    const { size } = await fs.stat(target);
    index.set(videoId, { bytes: size, usedAt: Date.now() });
    await prune(videoId);
    saveIndex();
    emit(Events.offlineSaved, { videoId });
  } catch (error) {
    if (saving !== job) return;
    // Error's message is the download failure's name (downloads.ts).
    if (error instanceof Error && error.message === 'blocked')
      blockedUntil = Date.now() + BLOCKED_MS;
  } finally {
    if (saving === job) saving = null;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Saves a copy of the song that is playing, unless there is one already or
 * Settings › Playback › Keep playing offline is off. Only one is saved at a
 * time: a newer song replaces one still being saved.
 */
export async function keepOffline(videoId: string): Promise<void> {
  if (stopped || !readSettings().keepOffline) return;
  await load();
  const known = index.get(videoId);
  if (known) {
    known.usedAt = Date.now();
    saveIndex();
    return;
  }
  if (savedFileOf(videoId) || saving?.videoId === videoId) return;
  if (Date.now() < blockedUntil || !takeDownloadStart()) return;
  cancelSaving();
  void save(videoId);
}

/** The songs of `videoIds` that can play without a connection. */
export async function offlineHas(videoIds: string[]): Promise<string[]> {
  await load();
  return videoIds.filter((id) => index.has(id) || !!savedFileOf(id));
}

/**
 * The file media://offline/<id> serves: the private copy, else the song
 * Downloads saved. Only a checked video id is looked up.
 */
export async function offlineFile(videoId: string): Promise<string | null> {
  if (!VIDEO_ID.test(videoId)) return null;
  await load();
  if (index.has(videoId)) return path.join(root(), copyName(videoId));
  return savedFileOf(videoId);
}

/** Whether YouTube can be reached right now. */
export async function isOnline(): Promise<boolean> {
  if (!net.isOnline()) return false;
  try {
    await net.fetch(PROBE_URL, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/** Turning the setting off removes every copy. */
export async function clearOffline(): Promise<void> {
  await load();
  cancelSaving();
  index = new Map();
  saveIndex();
  await writing;
  const names = await fs.readdir(root()).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => n.endsWith('.m4a'))
      .map((n) => fs.rm(path.join(root(), n), { force: true })),
  );
}

function cancelSaving(): void {
  const job = saving;
  saving = null;
  if (job?.child && job.child.exitCode === null) killTree(job.child);
}

/** Quitting or updating: nothing from the old version may keep running. */
export function stopOffline(): void {
  stopped = true;
  cancelSaving();
}

export function startOffline(): void {
  app.on('before-quit', stopOffline);
}
