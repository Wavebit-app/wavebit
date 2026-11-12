import { z } from 'zod';

/**
 * Listen together. The party server is BitChord's, and so is the wire format
 * (its `backend/README.md`); the Rust module reads and checks every frame, so
 * these are the shapes it hands on.
 */

/** BitChord's own server: wavebit and BitChord listeners can share a party. */
export const DEFAULT_PARTY_SERVER = 'https://api.bitchord.kushagrasingh.in';

/**
 * Where `docs/invite/index.html` is published, ending in `/invite/`, or null
 * while it isn't. Chat apps only make https links pressable, so once this is
 * set Copy invite link gives `<page>#CODE`, and the page opens wavebit.
 */
export const INVITE_PAGE: string | null = null;

/** A song as the party knows it. How each device plays it is its own business. */
export interface PartyTrack {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
  fromAutoplay: boolean;
}

export interface PartyMember {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  isHost: boolean;
  /** Holding a connection right now, not whether they are still in. */
  connected: boolean;
  joinedAtMs: number;
}

/** Where the party is: `positionMs` as of `anchorMs` on the server's clock. */
export interface PartyPlayback {
  seq: number;
  track: PartyTrack | null;
  queueSeq: number;
  queueIndex: number;
  isPlaying: boolean;
  positionMs: number;
  anchorMs: number;
  effectivePositionMs: number;
  startedBy: string | null;
  startedByName: string | null;
  autoplayEnabled: boolean;
}

export interface PartyQueue {
  seq: number;
  index: number;
  items: PartyTrack[];
}

export interface PartyFault {
  /** The server's code (`no_such_party`, `party_full`…) or one of wavebit's own. */
  code: string;
  message: string;
}

/** What the Rust session reports, whole, each time any of it changes. */
export interface PartySession {
  code: string | null;
  server: string | null;
  you: PartyMember | null;
  members: PartyMember[];
  maxMembers: number;
  hostOnlyControl: boolean;
  playback: PartyPlayback;
  queue: PartyQueue;
  connection: 'offline' | 'connecting' | 'live';
  /** False until the first round trip; the playhead is a guess until then. */
  clockSynced: boolean;
  roundTripMs: number;
  /** Server time minus this computer's clock (`Date.now()`). */
  offsetMs: number;
  /** A create or join is on its way. */
  busy: boolean;
  error: PartyFault | null;
}

/** Who is in a party, for someone invited to it; the server tells anyone holding the code. */
export interface PartyPreview {
  hostName: string;
  maxMembers: number;
  isFull: boolean;
  members: Pick<PartyMember, 'displayName' | 'avatarUrl' | 'isHost'>[];
}

export interface PartyInvite {
  code: string;
  host: string;
  /** It is on a server other than the one this device uses. */
  otherServer: boolean;
  /** Null while it is being asked for, or when the server can't say. */
  preview: PartyPreview | null;
}

export interface PartyState extends PartySession {
  /** Who this device joins as; null until there is a name to use. */
  me: PartyMe | null;
  /** An invite waiting for a yes, or for a name. */
  invite: PartyInvite | null;
  /** The server parties are started on. */
  serverHost: string;
}

export const IDLE_PARTY: PartySession = {
  code: null,
  server: null,
  you: null,
  members: [],
  maxMembers: 5,
  hostOnlyControl: false,
  playback: {
    seq: 0,
    track: null,
    queueSeq: 0,
    queueIndex: -1,
    isPlaying: false,
    positionMs: 0,
    anchorMs: 0,
    effectivePositionMs: 0,
    startedBy: null,
    startedByName: null,
    autoplayEnabled: false,
  },
  queue: { seq: 0, index: -1, items: [] },
  connection: 'offline',
  clockSynced: false,
  roundTripMs: 0,
  offsetMs: 0,
  busy: false,
  error: null,
};

export interface PartyProbe {
  ok: boolean;
  roundTripMs: number;
  parties: number | null;
  members: number | null;
}

/** The account name and picture the page knows, offered as who to join as. */
export const PartyMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    imageUrl: z
      .url({ protocol: /^https$/ })
      .max(1000)
      .nullable(),
  })
  .strict()
  .nullable();
export type PartyMe = NonNullable<z.infer<typeof PartyMeSchema>>;

const Position = z.number().int().min(0).max(86_400_000);

const TrackSchema = z
  .object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    title: z.string().max(300),
    artist: z.string().max(300),
    thumbnailUrl: z
      .url({ protocol: /^https$/ })
      .max(1000)
      .nullable(),
    durationMs: z.number().int().positive().max(86_400_000).nullable(),
    fromAutoplay: z.boolean(),
  })
  .strict();

/** The controls the page may send; the server decides who is allowed to. */
export const PartyControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), positionMs: Position }).strict(),
  z.object({ action: z.literal('pause'), positionMs: Position }).strict(),
  z.object({ action: z.literal('seek'), positionMs: Position }).strict(),
  z
    .object({
      action: z.literal('setTrack'),
      track: TrackSchema,
      positionMs: Position,
      isPlaying: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('setQueue'),
      queue: z.array(TrackSchema).min(1).max(26),
      queueIndex: z.number().int().min(0).max(25),
    })
    .strict(),
  z
    .object({
      action: z.literal('kick'),
      memberId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('setHostOnlyControl'),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('setAutoplay'), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('setMaxMembers'),
      maxMembers: z.number().int().min(2).max(10),
    })
    .strict(),
]);
export type PartyControl = z.infer<typeof PartyControlSchema>;

export const PartyCreateSchema = z.object({ autoplay: z.boolean() }).strict();
/** A code, or a pasted invite link. */
export const PartyJoinSchema = z
  .object({ text: z.string().min(1).max(600) })
  .strict();
