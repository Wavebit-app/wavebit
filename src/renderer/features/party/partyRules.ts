import type {
  PartyFault,
  PartyMember,
  PartyPlayback,
  PartyQueue,
} from '../../../shared/schemas/party';
import { DEFAULT_PARTY_SERVER } from '../../../shared/schemas/party.ts';

/**
 * Listen together's rules, apart from the player and the window so they can
 * be tested. The timing ones are BitChord's PartySync, number for number.
 */

/** A new control is landed on within this. */
const ALIGN_TOLERANCE_MS = 120;
/** Between controls, drift has to pass this twice in a row to be corrected… */
const DRIFT_LIMIT_MS = 1_200;
const DRIFT_STRIKES = 2;
/** …and then the player is left alone this long, because a seek costs a re-buffer. */
const DRIFT_COOLDOWN_MS = 6_000;

/**
 * Where this device should be in the party's song right now, in ms; null
 * without a song. `serverNow` null means the clock isn't measured yet, and
 * the answer is then the server's own reading when it sent the state.
 */
export function partyPositionMs(
  playback: PartyPlayback,
  serverNow: number | null,
): number | null {
  const track = playback.track;
  if (!track) return null;
  if (!playback.isPlaying) return playback.positionMs;
  if (serverNow === null) return playback.effectivePositionMs;
  const position =
    playback.positionMs + Math.max(0, serverNow - playback.anchorMs);
  return track.durationMs ? Math.min(position, track.durationMs) : position;
}

/** How far ahead the party's next start is scheduled; 0 once it is under way. */
export function msUntilStart(
  playback: PartyPlayback,
  serverNow: number | null,
): number {
  if (!playback.isPlaying || serverNow === null) return 0;
  return Math.max(0, playback.anchorMs - serverNow);
}

/**
 * Where `videoId` is in the party's queue. A queue keeps its history, so the
 * playing song can be in it twice: the state's own index wins when it names
 * the song, otherwise the nearest copy, looking forward first.
 */
export function queueIndexOf(
  queue: PartyQueue,
  playback: PartyPlayback,
  videoId: string | null | undefined,
): number {
  if (!videoId) return -1;
  const items = queue.items;
  const hint =
    playback.queueSeq === queue.seq ? playback.queueIndex : queue.index;
  if (items[hint]?.videoId === videoId) return hint;
  let best = -1;
  let bestDistance = Infinity;
  items.forEach((item, i) => {
    if (item.videoId !== videoId) return;
    const distance = i >= hint ? i - hint : (hint - i) * 2 + 1;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * The one member who adds AutoPlay's songs: the host while connected, else
 * the lowest connected member id. Nobody stands in for a host who has taken
 * control of the party.
 */
export function supplierId(
  members: PartyMember[],
  hostOnlyControl: boolean,
): string | null {
  const host = members.find((m) => m.isHost && m.connected)?.memberId ?? null;
  if (host || hostOnlyControl) return host;
  return (
    members
      .filter((m) => m.connected)
      .map((m) => m.memberId)
      .sort()[0] ?? null
  );
}

/** True for a listener in a party whose host has taken control of it. */
export const controlsLocked = (party: {
  code: string | null;
  hostOnlyControl: boolean;
  you: PartyMember | null;
}): boolean => !!party.code && party.hostOnlyControl && !party.you?.isHost;

/** What the last correction was made against. */
export interface DriftMemory {
  alignedSeq: number;
  anchorMs: number;
  positionMs: number;
  trackId: string | null;
  isPlaying: boolean;
  strikes: number;
  cooldownUntil: number;
}

export const newDrift = (): DriftMemory => ({
  alignedSeq: -1,
  anchorMs: 0,
  positionMs: 0,
  trackId: null,
  isPlaying: false,
  strikes: 0,
  cooldownUntil: 0,
});

/**
 * Whether a playing, settled player should jump to the party's position.
 * `driftMs` is how far ahead of the party it is; `now` is any steady clock.
 */
export function shouldSeek(
  memory: DriftMemory,
  playback: PartyPlayback,
  driftMs: number,
  now: number,
): boolean {
  if (playback.seq !== memory.alignedSeq) {
    // A control is landed on exactly, even by the device that sent it. A
    // change to the queue alone raises nothing here.
    const moved =
      memory.anchorMs !== playback.anchorMs ||
      memory.positionMs !== playback.positionMs ||
      memory.trackId !== (playback.track?.videoId ?? null) ||
      memory.isPlaying !== playback.isPlaying;
    memory.alignedSeq = playback.seq;
    memory.anchorMs = playback.anchorMs;
    memory.positionMs = playback.positionMs;
    memory.trackId = playback.track?.videoId ?? null;
    memory.isPlaying = playback.isPlaying;
    if (moved && Math.abs(driftMs) > ALIGN_TOLERANCE_MS) return true;
  }
  if (Math.abs(driftMs) <= DRIFT_LIMIT_MS) {
    memory.strikes = 0;
    return false;
  }
  if (now < memory.cooldownUntil) return false;
  if (++memory.strikes < DRIFT_STRIKES) return false;
  memory.strikes = 0;
  memory.cooldownUntil = now + DRIFT_COOLDOWN_MS;
  return true;
}

export type PingLevel = 'good' | 'slow' | 'poor';

/** The round trip bounds the clock's error at half of itself. */
export const pingLevel = (roundTripMs: number): PingLevel =>
  roundTripMs < 150 ? 'good' : roundTripMs <= 400 ? 'slow' : 'poor';

/**
 * The link to share. With an invite page published (`page`, ending in
 * `/invite/`) it is an https link, which chat apps make pressable, and the
 * page opens wavebit; without one it is wavebit's own link.
 */
export function inviteLink(
  code: string,
  server: string | null,
  page: string | null = null,
): string {
  const other =
    server && server !== DEFAULT_PARTY_SERVER
      ? `?server=${encodeURIComponent(server)}`
      : '';
  return page ? `${page}${other}#${code}` : `wavebit://party/${code}${other}`;
}

/** Which of `count` banners a party shows: the same one for everyone in it. */
export function bannerIndex(code: string, count: number): number {
  let sum = 0;
  for (const char of code) sum += char.charCodeAt(0);
  return count > 0 ? sum % count : 0;
}

const FAULTS: Record<string, string> = {
  bad_code: 'A party code is six letters or digits.',
  bad_server: 'That server address can’t be used. It has to start with https.',
  no_name: 'Add a name to join with first.',
  no_such_party: 'No party with that code.',
  party_full: 'That party is full.',
  create_rate_limited: 'Too many new parties. Try again in a minute.',
  rate_limited: 'Slow down a little. The party server is limiting you.',
  host_only: 'Only the host controls the music in this party.',
  queue_full: 'The party’s queue is full.',
  unreachable: 'Couldn’t reach the party server.',
  ended: 'That party has ended.',
  kicked: 'The host removed you from the party.',
  removed:
    'The host removed you from this party. You can join it again tomorrow.',
  failed: 'The party server sent an answer wavebit can’t read.',
  off: 'Listen together is off. Turn it on in Settings.',
};

/** wavebit's words for a fault it knows; the server's own for one it doesn't. */
export const faultMessage = (fault: PartyFault): string =>
  FAULTS[fault.code] ??
  (fault.message || 'Something went wrong with the party.');
