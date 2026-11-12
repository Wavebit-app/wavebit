import { toast } from '@heroui/react';
import type { PartyControl, PartyTrack } from '../../../shared/schemas/party';
import {
  partyPlayer,
  player,
  setPartyDoors,
  type Playable,
  type PlayerStash,
  type Upcoming,
} from '../player/player';
import {
  controlsLocked,
  msUntilStart,
  newDrift,
  partyPositionMs,
  queueIndexOf,
  shouldSeek,
  supplierId,
} from './partyRules';
import { partyNow, serverNow, watchParty } from './store';
import type { PartyState } from '../../../shared/schemas/party';

/**
 * Makes the player follow the party, and the party follow this player: a
 * port of BitChord's PartySync.
 *
 * The two directions use different doors (player.ts). Outbound, the player
 * calls `intent` after anything the listener does and whenever the queue
 * moves on. Inbound, `reconcile` writes through `partyPlayer`, which reports
 * nothing, so what is done here can't come back as an intent.
 *
 * A party song is a YouTube video id. A file or a Spotify row is shared as
 * its match on YouTube Music; this device keeps playing its own copy.
 */

const TICK_MS = 700;
const PAUSED_TOLERANCE_MS = 400;
/** A seek smaller than this is two devices finishing a song together, not a seek. */
const SEEK_REPORT_FLOOR_MS = 1_000;
const DEFERRED_PLAY_TIMEOUT_MS = 1_800;
const PUBLISH_DEBOUNCE_MS = 120;
/** After the listener acts, the party isn't followed until it has answered, or this long. */
const INTENT_QUIET_MS = 4_500;
/** The server keeps this many songs after the playing one. */
const MAX_UPCOMING = 25;
/** Songs with no video id yet that one publish looks up on YouTube Music. */
const LOOKUPS = 10;
/**
 * YouTube's player carries on some 300 to 500 ms after a seek, a different
 * amount each time. A seek is aimed ahead by the usual figure, and what is
 * left is closed without another re-buffer, by playing a touch fast or slow.
 */
const STREAM_SEEK_LAG_MS = 350;
/** Closer to the party than this is close enough. */
const NUDGE_OVER_MS = 40;
/** Further than this is a seek's job. */
const NUDGE_UNDER_MS = 1_500;
/** How much faster or slower a nudge plays (YouTube's player has quarter steps): gently for a small gap. */
const nudgeRate = (offMs: number) => (offMs > 400 ? 0.5 : 0.25);

// --- Songs across the boundary --------------------------------------------------

/** A song's video id; null when YouTube Music doesn't have it. */
const videoIds = new Map<string, string | null>();
/** This device's own song for a video id, so its file plays instead of the stream. */
const mine = new Map<string, Playable>();

/** Undefined means not looked up yet. */
const knownVideo = (track: Playable): string | null | undefined =>
  track.stream?.videoId ?? videoIds.get(track.id);

async function videoOf(track: Playable): Promise<string | null> {
  const known = knownVideo(track);
  if (known !== undefined) return known;
  const found = await window.wavebit.youtube
    .match(
      track.stream?.match ?? {
        title: track.title,
        artists: track.artist ? [track.artist] : [],
        durationMs: Math.round(track.durationMs),
      },
    )
    // Not being able to ask isn't an answer; it is asked again next time.
    .catch(() => undefined);
  if (found === undefined) return null;
  videoIds.set(track.id, found?.videoId ?? null);
  return found?.videoId ?? null;
}

function toPartyTrack(
  track: Playable,
  videoId: string,
  auto: boolean,
): PartyTrack {
  mine.set(videoId, track);
  const art = track.artwork;
  const ms = Math.round(track.durationMs);
  return {
    videoId,
    title: track.title.slice(0, 300),
    artist: track.artist.slice(0, 300),
    // A file's cover is on this computer; everyone can load YouTube's picture.
    thumbnailUrl:
      art?.startsWith('https://') && art.length <= 1000
        ? art
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationMs: ms > 0 && ms <= 86_400_000 ? ms : null,
    fromAutoplay: auto,
  };
}

const fromPartyTrack = (track: PartyTrack): Playable =>
  mine.get(track.videoId) ?? {
    id: `youtube:${track.videoId}`,
    title: track.title,
    artist: track.artist,
    album: '',
    albumKey: null,
    artwork: track.thumbnailUrl,
    durationMs: track.durationMs ?? 0,
    stream: { videoId: track.videoId },
  };

/** What Settings › Listen together says about this listener. */
let prefs: { pick: 'everyone' | 'queue'; delayMs: number } = {
  pick: 'everyone',
  delayMs: 0,
};
export function configurePartySync(next: typeof prefs): void {
  prefs = next;
}

/**
 * Where this device should be in the party's song: the party's place, moved
 * by the listener's audio delay while it plays (a speaker that lags is fed early).
 */
function target(party: PartyState): number | null {
  const want = partyPositionMs(party.playback, serverNow());
  if (want === null) return null;
  return want + (party.playback.isPlaying ? prefs.delayMs : 0);
}

const sameIds = (
  a: readonly (string | null | undefined)[],
  b: readonly string[],
) => a.length === b.length && a.every((id, i) => id === b[i]);

// --- State ------------------------------------------------------------------------

let quietUntil = 0;
/** The party states that will show every control this device sent has come back. */
let awaitSeq = Infinity;
let awaitQueueSeq = Infinity;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let startTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by each publish, so an older one that was still looking songs up stops. */
let publishRun = 0;
let publishing = false;
/** A Play this device accepted but may not perform until the party's start. */
let awaiting = false;
/** A listener in a locked party paused their own device. */
let locallyPaused = false;
let drift = newDrift();
/** This device's own songs the party hasn't been given yet; they follow as the queue moves on. */
let tail: Playable[] = [];
let stash: PlayerStash | null = null;
/** Nudges still allowed for the landing being settled, so a correction can't go on for ever. */
let trims = 0;
/** True while the song plays fast or slow to close a gap; nothing is measured meanwhile. */
let nudging = false;
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
/** The song the host last offered an empty party, so one it can't share isn't offered forever. */
let seeded: string | null = null;
let wasIn: string | null = null;

const send = (control: PartyControl) =>
  void window.wavebit.party.control(control).catch(() => {});

// --- Outbound ---------------------------------------------------------------------

let saidLockedAt = 0;
/** Tells a listener, at most every few seconds, why nothing happened. */
function sayLocked(party: PartyState): void {
  if (performance.now() - saidLockedAt < 4_000) return;
  saidLockedAt = performance.now();
  const host = party.members.find((m) => m.isHost)?.displayName ?? 'The host';
  toast(`${host} controls the music in this party.`, {
    description: 'Leave the party to play something else.',
  });
}

/**
 * The party's rules, asked before the player acts. In a locked party a
 * listener's action is refused and says why. In an open one, a picked song
 * joins the party's queue when Settings says so.
 */
function intercept(name: string, args: readonly unknown[]): boolean {
  const party = partyNow();
  if (!party.code) return false;
  if (controlsLocked(party)) {
    sayLocked(party);
    return true;
  }
  const picked = name === 'playList' || name === 'shuffleList';
  if (!picked || prefs.pick !== 'queue' || !party.playback.track) return false;
  const list = args[0] as Playable[];
  const at =
    name === 'playList'
      ? ((args[1] as number | undefined) ?? 0)
      : Math.floor(Math.random() * list.length);
  const song = list[at];
  if (song) {
    player.addToQueue(song);
    toast(`Added “${song.title}” to the party queue`);
  }
  return true;
}

function intent(): void {
  const party = partyNow();
  if (!party.code || controlsLocked(party)) return;
  quietUntil = performance.now() + INTENT_QUIET_MS;
  // Nothing is sent yet, so there is no state to wait for, and someone else's must not end the quiet.
  awaitSeq = Infinity;
  awaitQueueSeq = Infinity;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => void publish(), PUBLISH_DEBOUNCE_MS);
}

/** The songs after the current one that can be shared now, and the rest for later. */
function shareable(local: Upcoming[]): {
  ahead: (Upcoming & { id: string })[];
  rest: Playable[];
} {
  const ahead: (Upcoming & { id: string })[] = [];
  let at = 0;
  for (; at < local.length && ahead.length < MAX_UPCOMING; at++) {
    const id = knownVideo(local[at]!.track);
    if (id === undefined) break;
    // A song YouTube Music doesn't have is left out of the party.
    if (id) ahead.push({ ...local[at]!, id });
  }
  return { ahead, rest: local.slice(at).map((u) => u.track) };
}

/** Tells the party what this player is doing, as the difference from what the party has. */
async function publish(): Promise<void> {
  const run = ++publishRun;
  const current = player.current();
  if (!partyNow().code || !current) return;
  publishing = true;
  try {
    const id = await videoOf(current);
    if (run !== publishRun) return;
    if (!id) {
      // Nothing to tell the party; it brings its own song back.
      toast('This song isn’t on YouTube Music, so the party can’t hear it.');
      quietUntil = 0;
      return;
    }
    const local = [
      ...partyPlayer.upcoming(),
      ...tail.map((track) => ({ track, auto: false })),
    ];
    const first = shareable(local);
    const base = partyNow();
    let sent = sendQueue(current, id, first.ahead, null);
    const moved = sendPlayback(current, id);
    awaitSeq = moved ? base.playback.seq + 1 : 0;

    // The next few songs with no video id yet are looked up, then the queue goes out again.
    const unknown = local
      .filter((u) => knownVideo(u.track) === undefined)
      .slice(0, LOOKUPS);
    let last = first;
    if (unknown.length > 0) {
      await Promise.all(unknown.map((u) => videoOf(u.track)));
      if (run !== publishRun) return;
      last = shareable(local);
      sent += sendQueue(current, id, last.ahead, first.ahead);
    }
    awaitQueueSeq = sent > 0 ? base.queue.seq + sent : 0;
    // From here the player holds exactly what the party was given.
    tail = last.rest;
    const have = partyPlayer.upcoming().map((u) => knownVideo(u.track));
    if (
      !sameIds(
        have,
        last.ahead.map((u) => u.id),
      )
    )
      partyPlayer.setUpcoming(last.ahead);
    if (!moved && sent === 0) quietUntil = 0;
  } finally {
    if (run === publishRun) publishing = false;
  }
}

/** Sends the queue when it isn't what the party has (or what was just sent). Returns how many controls went. */
function sendQueue(
  current: Playable,
  id: string,
  ahead: (Upcoming & { id: string })[],
  justSent: (Upcoming & { id: string })[] | null,
): number {
  const ids = [id, ...ahead.map((u) => u.id)];
  if (justSent) {
    if (sameIds([id, ...justSent.map((u) => u.id)], ids)) return 0;
  } else {
    const party = partyNow();
    const at = queueIndexOf(party.queue, party.playback, id);
    const same =
      party.playback.track?.videoId === id &&
      at >= 0 &&
      sameIds(
        party.queue.items.slice(at).map((t) => t.videoId),
        ids,
      );
    if (same) return 0;
  }
  send({
    action: 'setQueue',
    queue: [
      toPartyTrack(current, id, false),
      ...ahead.map((u) => toPartyTrack(u.track, u.id, u.auto)),
    ],
    queueIndex: 0,
  });
  return 1;
}

/** Sends the one playback control that says what changed. Returns whether one went. */
function sendPlayback(current: Playable, id: string): boolean {
  const party = partyNow();
  // During a held-back Play the player isn't going yet; what the listener asked for is.
  const wantsPlaying = awaiting || partyPlayer.wantsPlaying();
  const positionMs = Math.max(
    0,
    Math.round(partyPlayer.positionMs() - (wantsPlaying ? prefs.delayMs : 0)),
  );
  if (party.playback.track?.videoId !== id) {
    // After the queue, never before: a song pointing into a list nobody has yet plays the wrong one.
    send({
      action: 'setTrack',
      track: toPartyTrack(current, id, false),
      positionMs,
      isPlaying: wantsPlaying,
    });
    return true;
  }
  if (party.playback.isPlaying !== wantsPlaying) {
    send({ action: wantsPlaying ? 'play' : 'pause', positionMs });
    return true;
  }
  const want = partyPositionMs(party.playback, serverNow());
  if (want !== null && Math.abs(positionMs - want) <= SEEK_REPORT_FLOOR_MS)
    return false;
  send({ action: 'seek', positionMs });
  return true;
}

function deferPlay(): boolean {
  const party = partyNow();
  if (!party.code || party.connection !== 'live' || !party.clockSynced)
    return false;
  awaiting = true;
  clearTimeout(startTimer);
  // The press must do something even if the party never answers.
  startTimer = setTimeout(() => {
    if (!awaiting) return;
    awaiting = false;
    if (!partyPlayer.wantsPlaying()) partyPlayer.play();
  }, DEFERRED_PLAY_TIMEOUT_MS);
  return true;
}

/**
 * Play and Pause that are this listener's alone. In a locked party: their own
 * pause, and a Play that rejoins where the party is. In an open one: only the
 * Play after a pause of their own (the sleep timer), which rejoins a playing
 * party instead of dragging it back to where they stopped.
 */
function aloneToggle(wantPlay: boolean): boolean {
  const party = partyNow();
  if (!party.code) return false;
  if (!controlsLocked(party)) {
    if (!locallyPaused || !wantPlay) return false;
    locallyPaused = false;
    if (!party.playback.isPlaying) return false;
  } else locallyPaused = !wantPlay;
  if (!wantPlay) partyPlayer.pause();
  else if (party.playback.isPlaying) {
    const want = target(party);
    if (want !== null && party.clockSynced) partyPlayer.seekTo(want / 1000);
    partyPlayer.play();
  }
  return true;
}

function pauseAlone(): void {
  locallyPaused = true;
  awaiting = false;
  partyPlayer.pause();
}

/** Measures the clock again and lands on the party's place, whatever the drift. */
export function resyncParty(): void {
  drift = newDrift();
  trims = 2;
  quietUntil = 0;
  void window.wavebit.party.resync().catch(() => {});
  reconcile();
}

function maySupply(): boolean {
  const party = partyNow();
  return (
    !party.code ||
    supplierId(party.members, party.hostOnlyControl) === party.you?.memberId
  );
}

// --- Inbound ----------------------------------------------------------------------

function reconcile(): void {
  const party = partyNow();
  if (!party.code) return;
  if (publishing || performance.now() < quietUntil) return;
  const state = party.playback;
  const track = state.track;
  if (!track) {
    // A new party plays nothing until someone presses something; the host hands it what is playing.
    const mine = player.current();
    if (
      party.connection === 'live' &&
      party.you?.isHost &&
      mine &&
      mine.id !== seeded
    ) {
      seeded = mine.id;
      intent();
    }
    return;
  }
  const current = player.current();
  if (!current || knownVideo(current) !== track.videoId) return load(party);
  followQueue(party);
  if (locallyPaused) {
    awaiting = false;
    return;
  }
  if (!state.isPlaying) {
    awaiting = false;
    endNudge();
    if (partyPlayer.wantsPlaying()) partyPlayer.pause();
    if (
      Math.abs(partyPlayer.positionMs() - state.positionMs) >
      PAUSED_TOLERANCE_MS
    )
      partyPlayer.seekTo(state.positionMs / 1000);
    return;
  }
  // A playing party can't be joined in time without a measured clock.
  if (!party.clockSynced) return;
  const want = target(party);
  if (want === null) return;
  if (!partyPlayer.wantsPlaying()) {
    const wait = msUntilStart(state, serverNow());
    clearTimeout(startTimer);
    if (wait > 0) {
      // Woken for the scheduled instant, not the next tick: late is what this avoids.
      startTimer = setTimeout(reconcile, wait);
      return;
    }
    // A resume is where it was paused; a seek here would only cost a re-buffer.
    if (Math.abs(partyPlayer.positionMs() - want) > PAUSED_TOLERANCE_MS)
      partyPlayer.seekTo(want / 1000);
    awaiting = false;
    trims = 2;
    partyPlayer.play();
    return;
  }
  awaiting = false;
  // Until a scheduled start the party's place stands still; a player already
  // going (the one that pressed) is measured once the party is going too.
  const lead = msUntilStart(state, serverNow());
  if (lead > 0) {
    clearTimeout(startTimer);
    startTimer = setTimeout(reconcile, lead);
    return;
  }
  // Only a settled player can be measured.
  if (!partyPlayer.settled()) {
    drift.strikes = 0;
    return;
  }
  if (nudging) return;
  const ahead = partyPlayer.positionMs() - want;
  const off = Math.abs(ahead);
  // Settling a landing: what a seek or a start left over is closed by a nudge or two.
  if (trims > 0 && off <= NUDGE_UNDER_MS) {
    trims--;
    if (off > NUDGE_OVER_MS) return nudge(ahead);
    trims = 0;
  }
  if (!shouldSeek(drift, state, ahead, performance.now())) return;
  if (off <= NUDGE_UNDER_MS) {
    trims = 1;
    return nudge(ahead);
  }
  trims = 3;
  // A file carries on at once; only a stream is aimed ahead.
  const lag = partyPlayer.isStream() ? STREAM_SEEK_LAG_MS : 0;
  partyPlayer.seekTo((want + lag) / 1000);
}

/** Plays a touch fast (when behind) or slow for exactly as long as closes the gap. */
function nudge(aheadMs: number): void {
  const off = Math.abs(aheadMs);
  const by = nudgeRate(off);
  nudging = true;
  partyPlayer.setRate(aheadMs < 0 ? 1 + by : 1 - by);
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(endNudge, off / by);
}

function endNudge(): void {
  if (!nudging) return;
  clearTimeout(nudgeTimer);
  nudging = false;
  partyPlayer.setRate(1);
}

/** Puts the party's songs in the player, at the party's place. */
function load(party: PartyState): void {
  const track = party.playback.track!;
  // A song the queue doesn't hold plays alone, never whatever is first in it.
  const at = queueIndexOf(party.queue, party.playback, track.videoId);
  const items = at >= 0 ? party.queue.items : [track];
  const now = serverNow();
  const startMs = target(party) ?? 0;
  const play =
    party.playback.isPlaying &&
    party.clockSynced &&
    msUntilStart(party.playback, now) <= 0;
  const auto = items.findIndex((t, i) => i > at && t.fromAutoplay);
  // Someone else chose this song, so what this device had lined up is over.
  tail = [];
  drift = newDrift();
  endNudge();
  trims = 3;
  partyPlayer.load(
    items.map(fromPartyTrack),
    Math.max(0, at),
    startMs / 1000,
    play,
    auto < 0 ? null : auto,
  );
}

/** Keeps the songs after the current one equal to the party's. */
function followQueue(party: PartyState): void {
  const current = player.current();
  if (!current) return;
  const at = queueIndexOf(party.queue, party.playback, knownVideo(current));
  if (at < 0) return;
  const wanted = party.queue.items.slice(at + 1, at + 1 + MAX_UPCOMING);
  const have = partyPlayer.upcoming().map((u) => knownVideo(u.track));
  if (
    sameIds(
      have,
      wanted.map((t) => t.videoId),
    )
  )
    return;
  partyPlayer.setUpcoming(
    wanted.map((t) => ({ track: fromPartyTrack(t), auto: t.fromAutoplay })),
  );
}

// --- Wiring -----------------------------------------------------------------------

function entered(): void {
  stash = partyPlayer.stash();
  partyPlayer.applyRate();
}

/** Forgets everything about the party just left, so none of it reaches the next. */
function reset(): void {
  clearTimeout(publishTimer);
  clearTimeout(startTimer);
  publishRun++;
  publishing = false;
  awaiting = false;
  locallyPaused = false;
  quietUntil = 0;
  awaitSeq = Infinity;
  awaitQueueSeq = Infinity;
  tail = [];
  seeded = null;
  trims = 0;
  endNudge();
  drift = newDrift();
}

function left(): void {
  reset();
  // The listener's own queue comes back, paused where it was.
  partyPlayer.restore(stash);
  stash = null;
  partyPlayer.applyRate();
}

/** Starts following the party. Mounted once, in the shell; returns the stop. */
export function startPartySync(): () => void {
  setPartyDoors({
    inParty: () => !!partyNow().code,
    intent,
    deferPlay,
    aloneToggle,
    pauseAlone,
    intercept,
    maySupply,
  });
  let key = '';
  const stopWatching = watchParty(() => {
    const party = partyNow();
    const next = `${party.playback.seq}|${party.queue.seq}|${party.code}|${party.clockSynced}`;
    if (next === key) return;
    key = next;
    if (party.code !== wasIn) {
      const before = wasIn;
      wasIn = party.code;
      if (!before && party.code) entered();
      else if (before && !party.code) left();
      // Straight from one party into another: the queue kept for afterwards stays the listener's own.
      else reset();
    }
    // Every control this device sent has come back around, or the party has moved past them.
    if (party.playback.seq >= awaitSeq && party.queue.seq >= awaitQueueSeq)
      quietUntil = 0;
    reconcile();
  });
  const tick = setInterval(reconcile, TICK_MS);
  return () => {
    stopWatching();
    clearInterval(tick);
    clearTimeout(publishTimer);
    clearTimeout(startTimer);
    setPartyDoors(null);
  };
}
