import { useSyncExternalStore } from 'react';
import type {
  Loudness,
  LocalTrack,
  HistoryEntry,
  PlayedSong,
} from '../../../shared/schemas/library';
import type {
  Crossfade,
  LoudnessLevel,
  PlaybackSpeed,
} from '../../../shared/schemas/settings';
import type { YtMatchQuery } from '../../../shared/schemas/youtube';
import { forLyricsSearch, primaryArtist } from '../../../shared/lrc';
import { sameRecording, songTitleOfVideo } from '../../../shared/lyricsParse';
import { checkNow, isDown, markDown, onBack } from '../../lib/connection';
import { artUrl, trackUrl } from '../../lib/format';
import { gainFor } from './gain';
import { FLAT_BANDS, isSilent, soundTargets } from './audioEffects';
import { newListen, REPORT_MS, tick } from './listenSampler';
import {
  notePoint,
  parsePoints,
  RESUME_AFTER_S,
  type ResumePoints,
} from './resumeRules';
import { buildSound, setSound, type Sound } from './soundGraph';
import { youtubeEmbed } from './youtubeEmbed';

/**
 * Anything the player can play: a local file (reached from Library, or a
 * Spotify or YouTube row that matched one), or a stream played by YouTube's
 * embedded player (`stream`).
 */
export interface Playable {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumKey: string | null;
  artwork: string | null;
  durationMs: number;
  /** Set when the song came from a Spotify playlist, for its Canvas. */
  spotifyUri?: string | null;
  /**
   * Played by YouTube's embedded player: the video, or (for a Spotify song
   * with no file) what to find it by on YouTube Music, as BitChord does.
   */
  stream?: {
    videoId: string | null;
    match?: YtMatchQuery;
    /** A music video, rather than a catalogue song. */
    isVideo?: boolean;
  } | null;
  /** A library file's facts, for Show details. */
  local?: {
    trackNo?: number;
    discNo?: number;
    addedAt: number;
    plays: number;
  };
}

const isStream = (t: Playable | null | undefined) => !!t?.stream;
/** Only files have play counts and loudness in Rust. */
export const isFile = (id: string) => /^[0-9a-f]{16}$/.test(id);

export type Repeat = 'off' | 'all' | 'one';

export interface PlayerState {
  queue: Playable[];
  /** Songs added with Play next, played before the rest of the queue. */
  upNext: Playable[];
  index: number;
  source: string;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  error: boolean;
  /** Asked to play, with no sound yet: starting, or waiting for more of the song. */
  loading: boolean;
  /** Paused for want of a connection; it carries on when the connection is back. */
  offline: boolean;
  /** A stream playing from its offline copy, on a deck, instead of YouTube's player. */
  fromCopy: boolean;
  /** True while two songs overlap in a crossfade. */
  blending: boolean;
  /** BitChord's AutoPlay: YouTube Music's radio when the queue runs low. */
  autoplay: boolean;
  /** Where AutoPlay's songs start in `queue`, or null when it hasn't added any. */
  autoplayStart: number | null;
  sleep: SleepChoice;
  /** When a timed sleep pauses the music, or null. */
  sleepAt: number | null;
}

/** What the sleep timer is set to: minutes, the end of this song, or nothing. */
export type SleepChoice = 'off' | '15' | '30' | '45' | '60' | 'song';

const AUTOPLAY_KEY = 'wavebit.autoplay';
function storedAutoplay(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

const QUEUE_KEY = 'wavebit.queue';
const RESUME_KEY = 'wavebit.resume';

export function fromLocal(track: LocalTrack): Playable {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumKey: track.album ? track.albumKey : null,
    artwork: track.hasArt ? artUrl(track.albumKey) : null,
    durationMs: track.durationMs,
    local: {
      trackNo: track.trackNo,
      discNo: track.discNo,
      addedAt: track.addedAt,
      plays: track.plays,
    },
  };
}

/** A song from wavebit's own listening history, ready to play again. */
export function fromHistory(entry: HistoryEntry): Playable {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    albumKey: entry.albumKey,
    artwork: entry.artwork,
    durationMs: entry.durationMs,
    spotifyUri: entry.spotifyUri,
    stream:
      entry.videoId || entry.match
        ? { videoId: entry.videoId, match: entry.match ?? undefined }
        : null,
  };
}

let state: PlayerState = {
  queue: [],
  upNext: [],
  index: -1,
  source: '',
  playing: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  error: false,
  loading: false,
  offline: false,
  fromCopy: false,
  blending: false,
  autoplay: storedAutoplay(),
  autoplayStart: null,
  sleep: 'off',
  sleepAt: null,
};
const listeners = new Set<() => void>();
let remember = true;
/** Where unfinished songs stopped, so choosing one again carries on from there. */
let points: ResumePoints = new Map();
/** The song that is sounding. A hand-queued one isn't `queue[index]`. */
let loadedId: string | null = null;
let order: number[] = [];
export interface PlaybackOptions {
  crossfade: Crossfade;
  normalize: boolean;
  level: LoudnessLevel;
  speed: PlaybackSpeed;
  skipSilence: boolean;
  spatial: boolean;
  equalizer: boolean;
  bands: readonly number[];
  balance: number;
  dontRepeat: boolean;
  musicOnly: boolean;
}

let options: PlaybackOptions = {
  crossfade: 0,
  normalize: true,
  level: 'normal',
  speed: 1,
  skipSilence: false,
  spatial: false,
  equalizer: false,
  bands: FLAT_BANDS,
  balance: 0,
  dontRepeat: false,
  musicOnly: false,
};

function set(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/**
 * Listen together's way in (features/party/partySync.ts). The player tells it
 * what the listener did; what the party does comes back through `partyPlayer`,
 * which reports nothing, so the two can't echo each other.
 */
export interface PartyDoors {
  inParty(): boolean;
  /** The listener did something, or the queue moved on by itself. */
  intent(): void;
  /** True when a Play was held back for the party's scheduled start. */
  deferPlay(): boolean;
  /**
   * True when Play or Pause was this listener's alone: in a party they may
   * not control, or coming back from a pause of their own.
   */
  aloneToggle(wantPlay: boolean): boolean;
  /** Pauses this device only (the sleep timer); the party carries on. */
  pauseAlone(): void;
  /** True when the party took the listener's action instead of the player (refused, or queued). */
  intercept(name: string, args: readonly unknown[]): boolean;
  /** Whether this device is the one that adds AutoPlay's songs. */
  maySupply(): boolean;
}
let doors: PartyDoors | null = null;
export function setPartyDoors(next: PartyDoors | null): void {
  doors = next;
}
/** In a party everyone plays at normal speed, or nobody stays in time. */
const rate = () => (doors?.inParty() ? 1 : options.speed);

// --- Two decks -----------------------------------------------------------------
//
// BitChord's crossfade, ported: two players, the incoming song loaded on the
// idle one at volume 0 and started; the faders then move equal-power while a
// trim of 1/sqrt(in + out) keeps the overlap from summing past full scale.
// Each deck carries its own song's loudness gain, so both sides of a blend
// are levelled for the song they are actually playing.

interface Deck {
  el: HTMLAudioElement;
  fade: GainNode | null;
  level: GainNode | null;
  analyser: AnalyserNode | null;
  trackId: string | null;
}

function makeDeck(): Deck {
  const el = new Audio();
  el.preload = 'auto';
  // Web Audio reads a media element only if it is CORS-clean; media:// answers with ACAO.
  el.crossOrigin = 'anonymous';
  return { el, fade: null, level: null, analyser: null, trackId: null };
}

const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
let active = 0;
const A = () => decks[active]!;
const B = () => decks[1 - active]!;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sound: Sound | null = null;

/** Sets the equaliser and stereo stages; off, they pass the sound untouched. */
function applySound(): void {
  if (ctx && sound) setSound(sound, soundTargets(options), ctx.currentTime);
}

/** Built on the first play (a user gesture), so the AudioContext may start. */
function graph(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = state.volume;
  master.connect(ctx.destination);
  sound = buildSound(ctx, master);
  for (const deck of decks) {
    const source = ctx.createMediaElementSource(deck.el);
    deck.level = ctx.createGain();
    deck.fade = ctx.createGain();
    deck.analyser = ctx.createAnalyser();
    source.connect(deck.level).connect(deck.fade).connect(sound.preamp);
    deck.level.connect(deck.analyser);
  }
  applySound();
  setInterval(watchSilence, SILENCE_POLL_MS);
}

// --- Skip silence ----------------------------------------------------------------

const SILENCE_POLL_MS = 100;
/** A gap has to last this long before it is skipped. */
const SILENCE_HOLD_MS = 1_000;
/** Fast enough to trim a gap, slow enough to catch the sound coming back. */
const SILENCE_SPEED = 4;
const silenceBlock = new Float32Array(2048);
let silentFor = 0;
let skippingSilence = false;

function endSilenceSkip(): void {
  silentFor = 0;
  if (!skippingSilence) return;
  skippingSilence = false;
  A().el.playbackRate = rate();
}

function watchSilence(): void {
  const analyser = A().analyser;
  if (
    !options.skipSilence ||
    doors?.inParty() ||
    !analyser ||
    streaming ||
    !state.playing ||
    state.blending
  ) {
    endSilenceSkip();
    return;
  }
  analyser.getFloatTimeDomainData(silenceBlock);
  if (!isSilent(silenceBlock)) {
    endSilenceSkip();
    return;
  }
  silentFor += SILENCE_POLL_MS;
  if (silentFor >= SILENCE_HOLD_MS && !skippingSilence) {
    skippingSilence = true;
    A().el.playbackRate = SILENCE_SPEED;
  }
}

/** The chosen speed on both decks and YouTube's player. */
function applySpeed(): void {
  for (const deck of decks) {
    deck.el.defaultPlaybackRate = rate();
    if (deck !== A() || !skippingSilence) deck.el.playbackRate = rate();
  }
  if (streaming) youtubeEmbed.setSpeed(rate());
}

// --- Sleep timer -----------------------------------------------------------------

let sleepTimer: ReturnType<typeof setTimeout> | undefined;

function pauseAll(): void {
  if (streaming) {
    youtubeEmbed.pause();
    set({ playing: false, loading: false });
    return;
  }
  settleBlend();
  A().el.pause();
}

/** The sleep timer's pause: in a party it is this device's alone. */
function sleepPause(): void {
  if (doors?.inParty()) doors.pauseAlone();
  else pauseAll();
}

/** True if the timer was waiting for this song to end; the music stops here. */
function sleepAtSongEnd(): boolean {
  if (state.sleep !== 'song') return false;
  set({ sleep: 'off', sleepAt: null });
  sleepPause();
  return true;
}

const CURVE_POINTS = 64;
const FADE_OUT = new Float32Array(CURVE_POINTS);
const FADE_IN = new Float32Array(CURVE_POINTS);
for (let i = 0; i < CURVE_POINTS; i++) {
  const t = i / (CURVE_POINTS - 1);
  const out = Math.cos((t * Math.PI) / 2);
  const inc = Math.sin((t * Math.PI) / 2);
  const trim = 1 / Math.sqrt(out + inc);
  FADE_OUT[i] = out * trim;
  FADE_IN[i] = inc * trim;
}

// --- Loudness ------------------------------------------------------------------

const loudness = new Map<string, Promise<Loudness>>();

/** Asks Rust once per song; the answer is stored there, so later runs are instant. */
function loudnessOf(id: string): Promise<Loudness> {
  let known = loudness.get(id);
  if (!known) {
    known = window.wavebit.library.loudness(id).catch(() => ({}) as Loudness);
    loudness.set(id, known);
  }
  return known;
}

function applyLevel(deck: Deck, id: string): void {
  if (!options.normalize) {
    deck.level?.gain.setTargetAtTime(1, ctx?.currentTime ?? 0, 0.05);
    return;
  }
  void loudnessOf(id).then((l) => {
    // The deck may have moved on to another song while Rust was measuring.
    if (deck.trackId !== id || !deck.level || !ctx) return;
    deck.level.gain.setTargetAtTime(
      gainFor(l, options.level),
      ctx.currentTime,
      0.1,
    );
  });
}

// --- Queue -----------------------------------------------------------------------

function shuffled(length: number, first: number): number[] {
  const rest = [...Array(length).keys()].filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [first, ...rest];
}

function persist(): void {
  // The party's queue isn't yours to come back to.
  if (!remember || doors?.inParty()) return;
  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({
        queue: state.queue,
        index: state.index,
        source: state.source,
        position: state.position,
      }),
    );
    localStorage.setItem(RESUME_KEY, JSON.stringify([...points]));
  } catch {
    // Storage full or blocked: the queue just won't survive a restart.
  }
}

/** Keeps the sounding song's place up to date as it plays. */
function notePlace(): void {
  if (loadedId) notePoint(points, loadedId, state.position, state.duration);
}

/** Where a song the listener chose starts: where it was left, else its beginning. */
function resumeAt(track: Playable): number {
  // Choosing the song that is playing starts it again.
  if (state.playing && track.id === loadedId) return 0;
  return points.get(track.id) ?? 0;
}

function updateMediaSession(track: Playable): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    ...(track.artwork && {
      artwork: [{ src: track.artwork, sizes: '512x512' }],
    }),
  });
}

/** The next index in play order, or -1 at the end. */
function step(delta: 1 | -1): number {
  const { queue, index, shuffle, repeat } = state;
  if (queue.length === 0) return -1;
  if (!shuffle) {
    const next = index + delta;
    if (next >= 0 && next < queue.length) return next;
    return repeat === 'all' ? (next + queue.length) % queue.length : -1;
  }
  const at = order.indexOf(index) + delta;
  if (at >= 0 && at < order.length) return order[at]!;
  return repeat === 'all' ? order[(at + order.length) % order.length]! : -1;
}

/** What follows the current song: a Play next song first, then the queue. */
function following(): { track: Playable; index: number | null } | null {
  const queued = state.upNext[0];
  if (queued) return { track: queued, index: null };
  const next = step(1);
  return next < 0 ? null : { track: state.queue[next]!, index: next };
}

/** Starts the song after the current one warming up in Rust, so its gain is ready. */
function prefetchNext(): void {
  const next = following();
  if (options.normalize && next && isFile(next.track.id))
    void loudnessOf(next.track.id);
}

// --- AutoPlay -------------------------------------------------------------------

/** Seeds already asked, so one that adds nothing isn't asked again (BitChord). */
const askedSeeds = new Set<string>();
/** Everything played or suggested since launch, for Don't repeat songs. */
const heardThisSession = new Set<string>();
let extending = false;

/** Songs left after the current one in play order (hand-queued ones aside). */
function remaining(): number {
  if (state.index < 0) return 0;
  return state.shuffle
    ? order.length - 1 - order.indexOf(state.index)
    : state.queue.length - 1 - state.index;
}

/**
 * When fewer than three songs are left (repeat off, AutoPlay on), asks
 * YouTube Music for the last song's radio and appends it, as BitChord's
 * store does. A Spotify song or a file is found on YouTube Music first.
 */
async function extendQueue(): Promise<void> {
  if (!state.autoplay || state.repeat !== 'off' || extending) return;
  // One device adds AutoPlay's songs for a whole party, or the same station goes out twice.
  if (doors && !doors.maySupply()) return;
  if (state.queue.length === 0 || remaining() >= 3) return;
  const last = state.queue.at(-1)!;
  const seedKey = last.stream?.videoId ?? `${last.title}|${last.artist}`;
  if (askedSeeds.has(seedKey)) return;
  askedSeeds.add(seedKey);
  extending = true;
  try {
    let seed = last.stream?.videoId ?? null;
    if (!seed)
      seed =
        (
          await window.wavebit.youtube.match({
            title: last.title,
            artists: last.artist ? [last.artist] : [],
            durationMs: Math.round(last.durationMs),
          })
        )?.videoId ?? null;
    if (!seed) return;
    const songs = await window.wavebit.youtube.radio(seed);
    const known = new Set(state.queue.map((t) => t.stream?.videoId ?? t.id));
    const added: Playable[] = songs
      .filter(
        (s) =>
          !known.has(s.videoId) &&
          !(options.dontRepeat && heardThisSession.has(s.videoId)),
      )
      .map((s) => ({
        id: `youtube:${s.videoId}`,
        title: s.title,
        artist: s.artists,
        album: '',
        albumKey: null,
        artwork: s.imageUrl,
        durationMs: s.durationMs,
        stream: { videoId: s.videoId, isVideo: s.isVideo },
      }));
    if (added.length === 0) return;
    for (const song of added) heardThisSession.add(song.stream!.videoId!);
    const start = state.queue.length;
    const fresh = added.map((_, i) => start + i);
    // Shuffle mixes AutoPlay only within its own section.
    order = [...order, ...(state.shuffle ? shuffledIndices(fresh) : fresh)];
    set({
      queue: [...state.queue, ...added],
      autoplayStart: state.autoplayStart ?? start,
    });
    persist();
    doors?.intent();
  } catch {
    // No radio this time; the queue simply ends.
  } finally {
    extending = false;
  }
}

function shuffledIndices(list: number[]): number[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function becomeCurrent(track: Playable, index: number | null): void {
  if (index === null) set({ upNext: state.upNext.slice(1) });
  else set({ index });
  set({ duration: track.durationMs / 1000, error: false });
  updateMediaSession(track);
  if (isFile(track.id))
    void window.wavebit.library.recordPlay(track.id).catch(() => {});
  persist();
  prefetchNext();
  void extendQueue();
}

// --- Crossfade -------------------------------------------------------------------

let fadeTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = 0;

function stopDeck(deck: Deck): void {
  deck.el.pause();
  deck.el.removeAttribute('src');
  deck.el.load();
  deck.trackId = null;
  if (deck.fade && ctx) {
    deck.fade.gain.cancelScheduledValues(ctx.currentTime);
    deck.fade.gain.value = 1;
  }
}

/** Ends a blend at once: the incoming song stays at full level, the outgoing one stops. */
function settleBlend(): void {
  if (!state.blending) return;
  clearTimeout(fadeTimer);
  stopDeck(B());
  if (A().fade && ctx) {
    A().fade!.gain.cancelScheduledValues(ctx.currentTime);
    A().fade!.gain.value = 1;
  }
  set({ blending: false });
}

function beginBlend(): void {
  const next = following();
  // A stream can't blend: YouTube's player has no fader wavebit can reach.
  if (!next || !ctx || isStream(next.track)) return;
  const outgoing = A();
  const incoming = B();
  set({ blending: true });
  incoming.trackId = next.track.id;
  incoming.el.src = trackUrl(next.track.id);
  incoming.el.currentTime = 0;
  incoming.fade!.gain.cancelScheduledValues(ctx.currentTime);
  incoming.fade!.gain.value = 0;
  applyLevel(incoming, next.track.id);

  // The switch happens the moment the incoming audio flows (BitChord's web player).
  incoming.el.addEventListener(
    'playing',
    () => {
      if (!ctx || incoming.trackId !== next.track.id) return;
      const remaining = (outgoing.el.duration || 0) - outgoing.el.currentTime;
      const length = Math.max(
        0.5,
        Math.min(options.crossfade, remaining / rate()),
      );
      const now = ctx.currentTime;
      outgoing.fade!.gain.cancelScheduledValues(now);
      outgoing.fade!.gain.setValueCurveAtTime(FADE_OUT, now, length);
      incoming.fade!.gain.setValueCurveAtTime(FADE_IN, now, length);
      active = 1 - active;
      // The outgoing song was heard to its end, though its last seconds overlap.
      if (loadedId) points.delete(loadedId);
      loadedId = next.track.id;
      becomeCurrent(next.track, next.index);
      set({ playing: true, position: 0 });
      fadeTimer = setTimeout(
        () => {
          stopDeck(outgoing);
          if (incoming.fade && ctx) {
            incoming.fade.gain.cancelScheduledValues(ctx.currentTime);
            incoming.fade.gain.value = 1;
          }
          set({ blending: false });
        },
        length * 1000 + 50,
      );
    },
    { once: true },
  );
  // If the next song can't start, the current one plays to its end and moves on normally.
  void incoming.el.play().catch(() => {
    stopDeck(incoming);
    set({ blending: false });
  });
}

// --- Loading ---------------------------------------------------------------------

// --- Streams: YouTube's embedded player ------------------------------------------

/** True while the current song plays in the embed rather than on a deck. */
let streaming = false;
/** Bumped on every load, so a slow YouTube search can't start a song that was skipped. */
let streamToken = 0;
let endedFor: string | null = null;
/** When YouTube's player last reported its time, and how many reports in a row have moved on. */
let streamTimeAt = 0;
let streamTicks = 0;
/**
 * For a moment after a new video or a seek is asked for, YouTube still
 * reports where it was. Until it reports the place asked for (or this long
 * passes), those reports are dropped.
 */
const ASK_HOLD_MS = 3_000;
let askedAt = 0;
let askedPlace = 0;
function asked(seconds: number): void {
  askedAt = performance.now();
  progressAt = askedAt;
  askedPlace = seconds;
  streamTicks = 0;
}

function skipSoon(token: number): void {
  setTimeout(() => token === streamToken && advance(), 1500);
}

/**
 * The catalogue song for a music video, or null to keep playing the video.
 * Title, version and artist have to agree. Length doesn't: a video often runs
 * longer than its song, and a wrong song is worse than the video.
 */
async function audioVersionOf(track: Playable): Promise<string | null> {
  const artist = primaryArtist(track.artist);
  const title = songTitleOfVideo(forLyricsSearch(track.title), artist);
  const found = await window.wavebit.youtube
    .match({
      title,
      artists: artist ? [artist] : [],
      durationMs: Math.round(track.durationMs),
    })
    .catch(() => null);
  if (!found) return null;
  const hit = { title: found.title, artist: found.artists };
  return sameRecording([hit], title, artist, 0) ? found.videoId : null;
}

async function loadStream(
  track: Playable,
  autoplay: boolean,
  at: number,
  /** Asks YouTube for the video again, even if it is the one it has: a stuck start. */
  reload = false,
): Promise<void> {
  const token = ++streamToken;
  const replacingStream = streaming;
  // A new queue entry can be scheduled for later. Stop the old iframe now;
  // otherwise it keeps sounding while the player already represents the new
  // track in state.
  if (replacingStream) youtubeEmbed.pause();
  // Matching and the Music-only lookup can be asynchronous. Ignore reports
  // from the previous video during that gap as well.
  youtubeEmbed.invalidate();
  leaveCopy();
  streaming = true;
  streamStarted = false;
  progressAt = performance.now();
  asked(at);
  // Until the new video is asked for, the embed still reports the last one's time.
  loadedId = null;
  endedFor = null;
  settleBlend();
  A().el.pause();
  set({
    position: at,
    duration: track.durationMs / 1000,
    error: false,
    offline: false,
    playing: false,
    loading: autoplay,
  });
  updateMediaSession(track);
  persist();
  let id = track.stream?.videoId ?? null;
  if (!id && track.stream?.match) {
    const found = await window.wavebit.youtube
      .match(track.stream.match)
      .catch(() => null);
    if (token !== streamToken) return;
    id = found?.videoId ?? null;
    // Kept on the queue entry, so the next play of it doesn't search again.
    if (id)
      set({
        queue: state.queue.map((t) =>
          t === track ? { ...t, stream: { ...t.stream, videoId: id } } : t,
        ),
      });
  }
  if (id && options.musicOnly && track.stream?.isVideo) {
    const audio = await audioVersionOf(track);
    if (token !== streamToken) return;
    if (audio) {
      id = audio;
      // Kept on the queue entry, so the next play of it doesn't search again.
      set({
        queue: state.queue.map((t) =>
          t === track
            ? { ...t, stream: { videoId: audio, isVideo: false } }
            : t,
        ),
      });
      persist();
    }
  }
  if (!id) {
    // A paused selection with no resolved video has nothing to cue yet. It is
    // resolved on Play, when the player can actually request the stream.
    if (!autoplay) return;
    // Without a connection, YouTube Music can't be searched: not the song's fault.
    if (isDown() || !(await checkNow())) {
      if (token === streamToken) skipOffline();
      return;
    }
    if (token !== streamToken) return;
    set({ error: true, playing: false, loading: false });
    skipSoon(token);
    return;
  }
  if (!autoplay) {
    // Cue known tracks ahead of a scheduled start. YouTube's cue command
    // prepares the player but does not fetch the media until Play or seek.
    if (!isDown()) youtubeEmbed.load(id, at, false);
    return;
  }
  heardThisSession.add(id);
  if (isDown()) {
    const copy = await hasCopy(id);
    if (token !== streamToken) return;
    if (copy) playCopy(track, id, at);
    else skipOffline();
    return;
  }
  youtubeEmbed.setVolume(state.volume);
  youtubeEmbed.load(id, at, true, reload);
  loadedId = track.id;
  progressAt = performance.now();
  set({ playing: true });
  prefetchNext();
}

// --- Keep playing offline ---------------------------------------------------------
//
// YouTube's player only holds the next half minute or so of a song. While a
// stream plays, the main process saves a private copy of it
// (offline/offlineSongs.ts); when the stream gets stuck and the connection is
// gone, the song carries on from that copy on a deck, at the same second.

/** No new time from YouTube for this long while playing: the stream is stuck. */
const STALL_MS = 4_000;
/** The same, once the connection is known to be down. */
const STALL_OFFLINE_MS = 1_500;
/** A new video that hasn't started by now is stuck too. */
const START_MS = 10_000;
/** How long a stream plays before its copy is asked for, so skipped songs aren't saved. */
const KEEP_AFTER_MS = 3_000;

/** True while the current stream plays from its offline copy on a deck. */
let onCopy = false;
/** When the stream's time last moved on, and whether it has since it was asked for. */
let progressAt = 0;
let streamStarted = false;
let checkingStuck = false;
/** Songs passed over in a row for want of a copy, so an offline queue can't go round forever. */
let offlineSkips = 0;
/** Where those skips began: the song to wait on when nothing can play. */
let skipFrom = -1;

async function hasCopy(videoId: string): Promise<boolean> {
  const found = await window.wavebit.offline
    .has([videoId])
    .catch(() => [] as string[]);
  return found.length > 0;
}

function leaveCopy(): void {
  if (!onCopy) return;
  onCopy = false;
  set({ fromCopy: false });
}

/** Plays a stream's offline copy on the deck from `at` seconds; YouTube's player stops. */
function playCopy(track: Playable, videoId: string, at: number): void {
  if (streaming) {
    streaming = false;
    streamToken++;
    youtubeEmbed.pause();
  }
  settleBlend();
  onCopy = true;
  offlineSkips = 0;
  const deck = A();
  deck.trackId = track.id;
  loadedId = track.id;
  deck.el.src = `media://offline/${videoId}`;
  deck.el.currentTime = at;
  set({
    position: at,
    error: false,
    offline: false,
    fromCopy: true,
    loading: true,
  });
  graph();
  // Loudness is measured for library files only.
  if (deck.level && ctx)
    deck.level.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
  void deck.el.play().catch(() => set({ playing: false, loading: false }));
}

/** Back online (lib/connection.ts): a song paused for want of a connection carries on where it stopped. */
onBack(() => {
  offlineSkips = 0;
  if (!state.offline) return;
  set({ offline: false });
  const track = player.current();
  if (!track) return;
  if (isStream(track)) void loadStream(track, true, state.position, true);
  else load(track, true, state.position);
});

/** Pauses with "You're offline" on the song; onBack above starts it again. */
function goneOffline(): void {
  if (streaming) youtubeEmbed.pause();
  set({ playing: false, loading: false, offline: true });
  reportListening();
  persist();
  markDown();
}

/** Offline, a song with no copy is passed over for the next one that can play. */
function skipOffline(): void {
  markDown();
  if (offlineSkips === 0) skipFrom = state.index;
  const songs = state.queue.length + state.upNext.length;
  if (++offlineSkips > songs || !following()) {
    offlineSkips = 0;
    // Nothing can play: wait on the song the listener chose, not the last one tried.
    const chosen = state.queue[skipFrom];
    if (chosen && skipFrom !== state.index) {
      set({
        index: skipFrom,
        position: points.get(chosen.id) ?? 0,
        duration: chosen.durationMs / 1000,
      });
      updateMediaSession(chosen);
    }
    goneOffline();
    return;
  }
  advance();
}

/** The stream has stopped making sound: carry on from the copy, or find out why. */
async function streamStuck(): Promise<void> {
  const track = player.current();
  const id = track?.stream?.videoId ?? null;
  const token = streamToken;
  if (!streaming || !track || !state.playing) return;
  if (id && (await hasCopy(id))) {
    if (token !== streamToken || !state.playing) return;
    playCopy(track, id, state.position);
    return;
  }
  // Online, the song is only slow: the spinner stays and YouTube carries on.
  if (await checkNow()) return;
  if (token !== streamToken || !state.playing) return;
  // A song that never started is passed over; one cut short waits where it is.
  if (streamStarted) goneOffline();
  else skipOffline();
}

setInterval(() => {
  if (!streaming || !state.playing || state.offline || checkingStuck) return;
  const limit = !streamStarted
    ? START_MS
    : isDown()
      ? STALL_OFFLINE_MS
      : STALL_MS;
  if (performance.now() - progressAt < limit) return;
  checkingStuck = true;
  void streamStuck().finally(() => {
    checkingStuck = false;
    progressAt = performance.now();
  });
}, 500);

// With a copy at hand, there's no need to wait for YouTube's buffer to run out.
window.addEventListener('offline', () => {
  if (streaming && state.playing) progressAt = 0;
});

/** Asks for the playing stream's copy once it has played a moment. */
function keepSoon(token: number): void {
  setTimeout(() => {
    const id = player.current()?.stream?.videoId;
    if (token !== streamToken || !streaming || !state.playing || !id) return;
    void window.wavebit.offline.keep(id).catch(() => {});
  }, KEEP_AFTER_MS);
}

let listening = newListen('', 0);
let listenedSong: PlayedSong | null = null;
/** The song already put in Recently played during this listen. */
let recentFor = '';

function playedSong(track: Playable): PlayedSong {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumKey: track.albumKey,
    artwork: track.artwork,
    durationMs: Math.round(track.durationMs),
    spotifyUri: track.spotifyUri ?? null,
    videoId: track.stream?.videoId ?? null,
    match: track.stream?.match ?? null,
  };
}

/** Writes down the time heard since the last report. */
function reportListening(): void {
  const { pendingMs: ms, pendingPlays: plays } = listening;
  if (!listenedSong || (ms === 0 && plays === 0)) return;
  listening.pendingMs = 0;
  listening.pendingPlays = 0;
  void window.wavebit.library
    .listened({ song: listenedSong, ms, plays })
    .catch(() => {});
}

function countListening(): void {
  const track = player.current();
  if (!track) return;
  const now = Date.now();
  if (listening.id !== track.id) {
    reportListening();
    listening = newListen(track.id, now);
    listenedSong = playedSong(track);
    recentFor = '';
    return;
  }
  listenedSong = playedSong(track);
  const length = state.duration * 1000 || track.durationMs;
  const counted = tick(listening, now, state.playing, length);
  // A song left unfinished is still the last one played: it joins Recently
  // played once it can be picked up again, and moves up when it counts.
  const resumable =
    recentFor !== track.id && listening.heard >= RESUME_AFTER_S * 1000;
  if (counted || resumable) {
    recentFor = track.id;
    void window.wavebit.library.played(listenedSong).catch(() => {});
  }
  if (listening.pendingMs >= REPORT_MS) reportListening();
}

// Closing the window keeps the place to the second, not to the last save.
window.addEventListener('pagehide', () => {
  reportListening();
  persist();
});

youtubeEmbed.on({
  playing: (playing, buffering) => {
    if (!streaming) return;
    set({ playing, loading: playing && buffering });
    // Out of sound mid-song: look for the copy now rather than after a silence.
    // (Not just after a seek, which buffers too.)
    if (playing && buffering && streamStarted && askedAt === 0) progressAt = 0;
    if (!playing) {
      reportListening();
      persist();
    }
    // YouTube's player goes back to normal speed for each new video.
    if (playing) youtubeEmbed.setSpeed(rate());
  },
  // Some YouTube Music rows name no artist; the player knows the channel.
  author: (videoId, name) => {
    const track = state.queue[state.index];
    if (!track || track.artist || track.stream?.videoId !== videoId) return;
    const queue = [...state.queue];
    queue[state.index] = { ...track, artist: primaryArtist(name) };
    set({ queue });
  },
  time: (position, duration) => {
    if (!streaming) return;
    if (
      performance.now() - askedAt < ASK_HOLD_MS &&
      Math.abs(position - askedPlace) > 3
    )
      return;
    askedAt = 0;
    streamTimeAt = performance.now();
    // A report that hasn't moved on is a video still buffering.
    const moved = position > state.position;
    streamTicks = moved ? streamTicks + 1 : 0;
    if (moved) {
      progressAt = streamTimeAt;
      if (!streamStarted) {
        streamStarted = true;
        offlineSkips = 0;
        keepSoon(streamToken);
      }
      if (state.loading) set({ loading: false });
    }
    set({ position, ...(duration > 0 && { duration }) });
    notePlace();
    countListening();
    if (Date.now() - lastSaved > 5_000) {
      lastSaved = Date.now();
      persist();
    }
  },
  ended: () => {
    const id = youtubeEmbed.current();
    // YouTube reports the end twice (state change and info); act once.
    if (!streaming || endedFor === id) return;
    // The second report can land after the next video was asked for: it is
    // the last song's end, not this one's.
    if (askedAt !== 0 && performance.now() - askedAt < ASK_HOLD_MS) return;
    endedFor = id;
    if (sleepAtSongEnd()) return;
    if (state.repeat === 'one') {
      endedFor = null;
      youtubeEmbed.seek(0);
      youtubeEmbed.play();
    } else advance();
  },
  error: () => {
    if (!streaming) return;
    set({ error: true, playing: false, loading: false });
    skipSoon(streamToken);
  },
});

function load(track: Playable, autoplay: boolean, at = 0): void {
  if (autoplay) void extendQueue();
  if (isStream(track)) {
    void loadStream(track, autoplay, at);
    return;
  }
  leaveCopy();
  if (streaming) {
    streaming = false;
    streamToken++;
    youtubeEmbed.pause();
  }
  settleBlend();
  const deck = A();
  deck.trackId = track.id;
  loadedId = track.id;
  deck.el.src = trackUrl(track.id);
  deck.el.currentTime = at;
  set({
    position: at,
    duration: track.durationMs / 1000,
    error: false,
    offline: false,
    loading: autoplay,
  });
  updateMediaSession(track);
  if (autoplay) {
    graph();
    applyLevel(deck, track.id);
    void deck.el.play().catch(() => set({ playing: false }));
    if (isFile(track.id))
      void window.wavebit.library.recordPlay(track.id).catch(() => {});
    prefetchNext();
  }
  persist();
}

/** Plays the current song from where it is. */
function resume(): void {
  if (streaming) {
    const track = player.current();
    const loaded = youtubeEmbed.current();
    // A restored queue has no matching embed video. A cued video should be
    // played in place instead of being loaded again at its scheduled start.
    if (track && (!loaded || loaded !== track.stream?.videoId || state.offline))
      void loadStream(track, true, state.position, true);
    // The button answers at once; the embed's own state report confirms it.
    else {
      youtubeEmbed.play();
      set({ playing: true });
    }
    return;
  }
  settleBlend();
  graph();
  if (A().trackId && !onCopy) applyLevel(A(), A().trackId!);
  void A()
    .el.play()
    .catch(() => {});
}

function startList(
  list: Playable[],
  start: number,
  source: string,
  at: number,
): void {
  order = shuffled(list.length, start);
  // A new list keeps the songs you added by hand right after it (BitChord).
  set({ queue: list, index: start, source, autoplayStart: null });
  load(list[start]!, true, at);
}

export const player = {
  /** Applies Settings › Playback; a level change takes effect on the playing song too. */
  configure(next: PlaybackOptions): void {
    const levelChanged =
      next.normalize !== options.normalize || next.level !== options.level;
    const speedChanged = next.speed !== options.speed;
    options = next;
    if (levelChanged && A().trackId) applyLevel(A(), A().trackId!);
    if (speedChanged) applySpeed();
    applySound();
  },
  /** Lets a slider be heard while it moves, before the value is saved. */
  previewEqualizer(bands: readonly number[], balance: number): void {
    options = { ...options, bands, balance };
    applySound();
  },
  /** Pauses after some minutes or at the end of this song; `off` cancels it. */
  setSleep(choice: SleepChoice): void {
    clearTimeout(sleepTimer);
    if (choice === 'off' || choice === 'song') {
      set({ sleep: choice, sleepAt: null });
      return;
    }
    const ms = Number(choice) * 60_000;
    set({ sleep: choice, sleepAt: Date.now() + ms });
    sleepTimer = setTimeout(() => {
      set({ sleep: 'off', sleepAt: null });
      sleepPause();
    }, ms);
  },
  /**
   * Plays `list` from `start`, replacing the queue. A song that was left
   * before its end carries on from where it stopped.
   */
  playList(list: Playable[], start = 0, source = ''): void {
    if (list.length === 0) return;
    startList(list, start, source, resumeAt(list[start]!));
  },
  /** A shuffle picks the first song itself, so it starts at its beginning. */
  shuffleList(list: Playable[], source = ''): void {
    if (list.length === 0) return;
    set({ shuffle: true });
    startList(list, Math.floor(Math.random() * list.length), source, 0);
  },
  toggle(): void {
    if (state.index < 0) return;
    const wantPlay = streaming ? !state.playing : A().el.paused;
    if (doors?.aloneToggle(wantPlay)) return;
    // In a party a Play waits for the instant everyone starts at.
    if (wantPlay && doors?.deferPlay()) return doors.intent();
    if (wantPlay) resume();
    else pauseAll();
    doors?.intent();
  },
  next(): void {
    const next = following();
    if (!next) {
      if (streaming) youtubeEmbed.pause();
      settleBlend();
      A().el.pause();
      return;
    }
    if (next.index === null) set({ upNext: state.upNext.slice(1) });
    else set({ index: next.index });
    load(next.track, true);
  },
  previous(): void {
    settleBlend();
    const restart = () =>
      streaming ? youtubeEmbed.seek(0) : (A().el.currentTime = 0);
    // Past ten seconds, Previous restarts the song (BitChord's BACK_RESTARTS_AFTER_SEC).
    if ((streaming ? state.position : A().el.currentTime) > 10) {
      restart();
      return;
    }
    const prev = step(-1);
    if (prev < 0) {
      restart();
      return;
    }
    set({ index: prev });
    load(state.queue[prev]!, true);
  },
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    if (streaming) {
      asked(Math.max(0, seconds));
      youtubeEmbed.seek(Math.max(0, seconds));
      set({ position: Math.max(0, seconds) });
      notePlace();
      persist();
      return;
    }
    settleBlend();
    const el = A().el;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
  },
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    else for (const deck of decks) deck.el.volume = v;
    youtubeEmbed.setVolume(v);
    set({ volume: v });
  },
  toggleShuffle(): void {
    order = shuffled(state.queue.length, Math.max(0, state.index));
    set({ shuffle: !state.shuffle });
  },
  cycleRepeat(): void {
    set({
      repeat:
        state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off',
    });
  },
  setRepeat(repeat: Repeat): void {
    set({ repeat });
  },
  playNext(track: Playable): void {
    set({ upNext: [track, ...state.upNext] });
  },
  addToQueue(track: Playable): void {
    set({ upNext: [...state.upNext, track] });
  },
  removeUpcoming(at: number): void {
    // `at` counts from the song after the current one, in play order.
    const target = player.upcoming()[at];
    if (!target) return;
    const queue = state.queue.filter((_, i) => i !== target.index);
    const index = target.index < state.index ? state.index - 1 : state.index;
    order = order
      .filter((i) => i !== target.index)
      .map((i) => (i > target.index ? i - 1 : i));
    const start = state.autoplayStart;
    set({
      queue,
      index,
      autoplayStart: start !== null && target.index < start ? start - 1 : start,
    });
    persist();
  },
  removeUpNext(at: number): void {
    set({ upNext: state.upNext.filter((_, i) => i !== at) });
  },
  /** Moves an upcoming song from one place to another, Alt Up and Alt Down included. */
  moveUpcoming(from: number, to: number): void {
    if (state.shuffle) return; // shortcut: reordering follows queue order only
    const base = state.index + 1;
    const queue = [...state.queue];
    const [moved] = queue.splice(base + from, 1);
    if (!moved) return;
    queue.splice(
      base + Math.max(0, Math.min(to, queue.length - base)),
      0,
      moved,
    );
    set({ queue });
    persist();
  },
  /** Clear removes only the songs you added by hand (BitChord); the list itself stays. */
  clearAdded(): void {
    set({ upNext: [] });
  },
  /** Plays a song of the list (or AutoPlay) now, from where it is. */
  playAt(index: number): void {
    const track = state.queue[index];
    if (!track) return;
    const at = resumeAt(track);
    set({ index });
    load(track, true, at);
  },
  /** Plays a hand-queued song now; the hand-queued songs it skips over go. */
  playAdded(at: number): void {
    const track = state.upNext[at];
    if (!track) return;
    set({ upNext: state.upNext.slice(at + 1) });
    load(track, true, resumeAt(track));
  },
  toggleAutoplay(): void {
    const autoplay = !state.autoplay;
    set({ autoplay });
    try {
      localStorage.setItem(AUTOPLAY_KEY, autoplay ? 'on' : 'off');
    } catch {
      // Not remembered; it still applies now.
    }
    if (autoplay) void extendQueue();
  },
  /** What plays after the current song, in play order. */
  upcoming(): { track: Playable; index: number }[] {
    const indices = state.shuffle
      ? order.slice(order.indexOf(state.index) + 1)
      : [...state.queue.keys()].slice(state.index + 1);
    return indices.map((index) => ({ track: state.queue[index]!, index }));
  },
  current(): Playable | null {
    return state.queue[state.index] ?? null;
  },
  /** Restores the last queue, paused where it stopped. */
  restore(enabled: boolean): void {
    remember = enabled;
    if (!enabled || state.index >= 0) return;
    try {
      points = parsePoints(localStorage.getItem(RESUME_KEY));
      const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? 'null') as {
        queue: Playable[];
        index: number;
        source: string;
        position: number;
      } | null;
      const track = saved?.queue[saved.index];
      if (!saved || !track) return;
      order = shuffled(saved.queue.length, saved.index);
      set({ queue: saved.queue, index: saved.index, source: saved.source });
      load(track, false, saved.position);
    } catch {
      localStorage.removeItem(QUEUE_KEY);
    }
  },
};

// Each of these is the listener's own doing, or the queue moving on by itself:
// in a party, the party hears about it.
for (const name of [
  'playList',
  'shuffleList',
  'next',
  'previous',
  'seek',
  'playNext',
  'addToQueue',
  'removeUpcoming',
  'removeUpNext',
  'moveUpcoming',
  'clearAdded',
  'playAt',
  'playAdded',
  'toggleShuffle',
] as const) {
  const act = player[name] as (...args: never[]) => void;
  (player[name] as unknown) = (...args: never[]) => {
    if (byListener && doors?.intercept(name, args)) return;
    act(...args);
    doors?.intent();
  };
}

/** False while the queue moves on by itself, which no party rule refuses. */
let byListener = true;
/** The song ended, or couldn't play: on to the next one. */
function advance(): void {
  byListener = false;
  try {
    player.next();
  } finally {
    byListener = true;
  }
}

/** A song still to come, and whether AutoPlay added it. */
export interface Upcoming {
  track: Playable;
  auto: boolean;
}

/** What the listener had before a party, to give back after it. */
export interface PlayerStash {
  queue: Playable[];
  upNext: Playable[];
  index: number;
  source: string;
  autoplayStart: number | null;
  order: number[];
  position: number;
}

/**
 * The party's hands on the player. Nothing done here is reported back to the
 * party, which is what keeps following it from looking like the listener's
 * own doing.
 */
export const partyPlayer = {
  /** Replaces the queue with the party's and plays (or waits at) `at` seconds. */
  load(
    list: Playable[],
    index: number,
    at: number,
    play: boolean,
    autoplayStart: number | null,
  ): void {
    order = [...list.keys()];
    set({ queue: list, upNext: [], index, source: '', autoplayStart });
    load(list[index]!, play, at);
  },
  /** What plays after the current song, hand-queued songs first, in play order. */
  upcoming(): Upcoming[] {
    const from = state.autoplayStart;
    return [
      ...state.upNext.map((track) => ({ track, auto: false })),
      ...player.upcoming().map((u) => ({
        track: u.track,
        auto: from !== null && u.index >= from,
      })),
    ];
  },
  /** Replaces what plays after the current song. */
  setUpcoming(list: Upcoming[]): void {
    const head = state.queue.slice(0, state.index + 1);
    const queue = [...head, ...list.map((u) => u.track)];
    const auto = list.findIndex((u) => u.auto);
    // The party's order is the order, shuffle or not.
    order = [...queue.keys()];
    set({
      queue,
      upNext: [],
      autoplayStart: auto < 0 ? null : head.length + auto,
    });
  },
  play: resume,
  pause: pauseAll,
  seekTo(seconds: number): void {
    if (!streaming) {
      settleBlend();
      A().el.currentTime = seconds;
      return;
    }
    // Before the video is asked for, the place is only written down.
    const loaded = youtubeEmbed.current();
    if (loaded && loaded === player.current()?.stream?.videoId)
      youtubeEmbed.seek(seconds);
    asked(seconds);
    streamTimeAt = performance.now();
    set({ position: seconds });
  },
  /** Where the song is right now. YouTube reports a few times a second, so the gap is counted in. */
  positionMs(): number {
    if (!streaming) return A().el.currentTime * 1000;
    // Nothing is counted in until the video has reported from the place asked for.
    const since =
      state.playing && askedAt === 0
        ? Math.min(500, performance.now() - streamTimeAt)
        : 0;
    return state.position * 1000 + since;
  },
  /** Playing, or on its way to. */
  wantsPlaying: (): boolean => state.playing,
  /** Played by YouTube's player, which takes a moment to carry on after a seek. */
  isStream: (): boolean => streaming,
  /** Really sounding, so its position can be compared with the party's. */
  settled(): boolean {
    if (!state.playing) return false;
    if (streaming) return streamTicks >= 2;
    const el = A().el;
    return !el.paused && !el.seeking && el.readyState >= 3;
  },
  /** Entering or leaving a party changes which speed applies. */
  applyRate: applySpeed,
  stash(): PlayerStash {
    return {
      queue: state.queue,
      upNext: state.upNext,
      index: state.index,
      source: state.source,
      autoplayStart: state.autoplayStart,
      order: [...order],
      position: partyPlayer.positionMs() / 1000,
    };
  },
  /** Puts the listener's own queue back, paused where it was. */
  restore(stash: PlayerStash | null): void {
    pauseAll();
    const track = stash?.queue[stash.index];
    if (!stash || !track) return;
    order = stash.order;
    set({
      queue: stash.queue,
      upNext: stash.upNext,
      index: stash.index,
      source: stash.source,
      autoplayStart: stash.autoplayStart,
    });
    load(track, false, stash.position);
    // Loading a file resets its deck without a pause event.
    set({ playing: false });
  },
};

// Every event is filtered to the deck that is current; the other deck is either
// idle or the song fading out.
for (const deck of decks) {
  // While YouTube's player has the song, a deck's late pause or time is the last song's.
  const current = () => deck === A() && !streaming;
  deck.el.addEventListener('play', () => current() && set({ playing: true }));
  deck.el.addEventListener('playing', () => {
    if (!current()) return;
    offlineSkips = 0;
    if (state.loading) set({ loading: false });
  });
  // Out of sound to play: still starting, or reading more of the file.
  deck.el.addEventListener('waiting', () => {
    if (current() && !deck.el.paused) set({ loading: true });
  });
  deck.el.addEventListener('pause', () => {
    if (!current() || state.blending) return;
    set({ playing: false, loading: false });
    reportListening();
    persist();
  });
  // A seek while paused is where the song should carry on from.
  deck.el.addEventListener('seeked', () => {
    if (!current() || !deck.el.paused) return;
    set({ position: deck.el.currentTime });
    notePlace();
    persist();
  });
  deck.el.addEventListener('durationchange', () => {
    if (current() && Number.isFinite(deck.el.duration))
      set({ duration: deck.el.duration });
  });
  deck.el.addEventListener('timeupdate', () => {
    if (!current()) return;
    set({ position: deck.el.currentTime });
    notePlace();
    countListening();
    const remaining = (deck.el.duration || 0) - deck.el.currentTime;
    if (
      options.crossfade > 0 &&
      // A blend plays two songs at once; a party is in one place.
      !doors?.inParty() &&
      !state.blending &&
      !deck.el.paused &&
      state.repeat !== 'one' &&
      state.sleep !== 'song' &&
      deck.el.duration > options.crossfade * 2 + 1 &&
      remaining <= options.crossfade * rate() &&
      !isStream(following()?.track)
    )
      beginBlend();
    if (Date.now() - lastSaved > 5_000) {
      lastSaved = Date.now();
      persist();
    }
  });
  deck.el.addEventListener('ended', () => {
    if (!current()) return;
    if (sleepAtSongEnd()) return;
    if (state.repeat === 'one') {
      deck.el.currentTime = 0;
      void deck.el.play();
    } else advance();
  });
  // A file deleted since the last scan: say so.
  deck.el.addEventListener(
    'error',
    () =>
      current() &&
      deck.trackId &&
      set({ error: true, playing: false, loading: false }),
  );
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => player.toggle());
  ms.setActionHandler('pause', () => player.toggle());
  ms.setActionHandler('nexttrack', () => player.next());
  ms.setActionHandler('previoustrack', () => player.previous());
  ms.setActionHandler(
    'seekto',
    (d) => d.seekTime !== undefined && player.seek(d.seekTime),
  );
}

/** True while YouTube's embedded player is the one playing (YouTubeStage shows it). */
export function useStreaming(): boolean {
  return usePlayer((s) => isStream(s.queue[s.index]) && !s.fromCopy);
}

/** Subscribes to one slice; components re-render only when it changes. */
export function usePlayer<T>(select: (s: PlayerState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}
