import Store from 'electron-store';
import { createHmac, randomUUID } from 'node:crypto';
import type {
  Party,
  PartyPreview as NativePreview,
  PartyProbe as NativeProbe,
} from '../../../native/index';
import { Events } from '../../shared/ipc/channels';
import {
  BITCHORD_PARTY_SERVER,
  IDLE_PARTY,
  PARTY_REACTIONS,
  type PartyControl,
  type PartyFault,
  type PartyMe,
  type PartyPreview,
  type PartyProbe,
  type PartyReaction,
  type PartyReactionId,
  type PartySession,
  type PartyState,
  WAVEBIT_PARTY_SERVER,
  WAVEBIT_RELAY,
} from '../../shared/schemas/party';
import { emit } from '../ipc/handle';
import { native } from '../services/native';
import {
  onSettingsChange,
  readSettings,
  writeSettings,
} from '../services/settings';
import { shut, stillShut } from './doorRules';
import { type Helper, helperPath, startHelper } from './p2p';
import { newSecret, p2pLink, safetyNumber } from './p2pRules';

/**
 * Listen together, the main process's part: who this device joins as, which
 * server, and invite links. The connection, the clock and the party's state
 * are the Rust module's (`native/src/party`), which also keeps the party
 * token; nothing here ever holds it.
 */

/** The only link type the system may hand over. Pasted links may be BitChord's too. */
const LINK = 'wavebit://';

interface PartyFile {
  deviceId: string;
  shut: unknown;
  /** The server choice was set once for an install that predates it. */
  serverMigrated: boolean;
}

// Opened on first use, so a test profile set in main.ts applies before the path is read.
let opened: Store<PartyFile> | null = null;
const store = () =>
  (opened ??= new Store<PartyFile>({
    name: 'party',
    defaults: { deviceId: '', shut: {}, serverMigrated: false },
    clearInvalidConfig: true,
  }));

/**
 * This device's secret, random and tied to nothing. It never leaves the
 * device: each server gets ids worked out from it (see `identity`).
 */
function deviceSecret(): string {
  let id = store().get('deviceId');
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    id = randomUUID();
    store().set('deviceId', id);
  }
  return id;
}

/** True for a party the host removed this device from within the last day. */
const doorShut = (code: string) =>
  code in stillShut(store().get('shut'), Date.now());

let core: Party | null = null;
let session: PartySession = IDLE_PARTY;
/** The account name and picture the page offered. */
let account: PartyMe | null = null;
/**
 * An invite waiting for a yes or for a name. `server` null is this device's
 * own. `ask` is set for one that came as a link: joining shows this device's
 * name and picture to the party and starts its music here, and a link is
 * something anyone can send, so it waits for a press.
 */
let invite: {
  code: string;
  server: string | null;
  ask: boolean;
  preview: PartyPreview | null;
  /** When it arrived; a press just after a new invite replaced one is ignored. */
  since: number;
  /** A party on someone's computer: who, the key, and a relay the link named. */
  peer: { peer: string; key: string; relay: string | null } | null;
} | null = null;

/**
 * The helper for a party on a computer, this one's or someone's. `claimed`
 * once a create or join has been sent through it, `seen` once the party is
 * on it; it stops when the party moves off it.
 */
let helper: (Helper & { claimed: boolean; seen: boolean }) | null = null;
/** The helper is starting, before the party client is asked. */
let starting = false;
/** Something wavebit itself refused, before the server was asked. */
let refusal: PartyFault | null = null;

function party(): Party {
  return (core ??= new (native().Party)(
    (json: string) => {
      const before = session;
      session = JSON.parse(json) as PartySession;
      // Removed by the host: that party's door stays shut to this device for a day.
      if (before.code && !session.code && session.error?.code === 'kicked')
        store().set('shut', shut(store().get('shut'), before.code, Date.now()));
      followHelper(before);
      announce();
    },
    (json: string) => passReaction(JSON.parse(json) as PartyReaction),
  ));
}

/** Stops the helper once the party has moved off it, or never got onto it. */
function followHelper(before: PartySession): void {
  if (!helper) return;
  if (session.code && session.server === helper.origin) helper.seen = true;
  else if (
    helper.seen ||
    (helper.claimed && before.busy && !session.busy && !session.code)
  )
    stopHelper();
}

function stopHelper(): void {
  helper?.stop();
  helper = null;
  native().partySetBridge(null, null);
}

/** The relay for Host on this device: the one in Settings, else wavebit's. */
const relayAddress = (): string | null =>
  native().partyCleanRelay(readSettings().partyRelay) ?? WAVEBIT_RELAY;

/** The fault code a failed helper start carries. */
const helperFault = (e: unknown) =>
  e instanceof Error && /^[a-z_]{1,40}$/.test(e.message)
    ? e.message
    : 'p2p_failed';

/**
 * Starts the helper for a party on a computer, then points the party client
 * at its bridge. `then` creates or joins through it.
 */
async function throughHelper(
  options: {
    mode: 'host' | 'join';
    partyKey: string;
    relay: string;
    direct: boolean;
    hostPeer?: string;
  },
  then: (origin: string) => void,
): Promise<void> {
  stopHelper();
  starting = true;
  refusal = null;
  announce();
  let started: Helper;
  try {
    started = await startHelper({
      ...options,
      onLinks: () => announce(),
      onExit: () => {
        if (helper?.origin !== started.origin) return;
        const wasIn = session.server === started.origin;
        helper = null;
        native().partySetBridge(null, null);
        if (wasIn) {
          core?.leave(0);
          refuse('p2p_stopped');
        }
      },
    });
  } catch (e) {
    starting = false;
    return refuse(helperFault(e));
  }
  starting = false;
  if (!enabled()) return void started.stop();
  // The same object the helper updates its link counts on.
  helper = Object.assign(started, { claimed: true, seen: false });
  native().partySetBridge(started.origin, started.bridgeKey);
  then(started.origin);
}

/** wavebit's server when it is running, else BitChord's. */
const ownServer = () => WAVEBIT_PARTY_SERVER ?? BITCHORD_PARTY_SERVER;

/** The server parties are started on, as Settings chooses. */
function server(): string {
  const { partyServerChoice, partyServer } = readSettings();
  if (partyServerChoice === 'bitchord') return BITCHORD_PARTY_SERVER;
  if (partyServerChoice === 'custom')
    return native().partyCleanServer(partyServer) ?? ownServer();
  return ownServer();
}

const hostOf = (origin: string) => origin.replace(/^https?:\/\//, '');

function me(): PartyMe | null {
  const { partyName, partyShareAvatar } = readSettings();
  const name = partyName.trim() || account?.name;
  if (!name) return null;
  return {
    name,
    imageUrl: partyShareAvatar ? (account?.imageUrl ?? null) : null,
  };
}

/**
 * Who this device joins `origin` as. Each server gets its own ids, worked
 * out from a secret that stays here, so no server learns what this device is
 * called on another, and a server a link named can't take this device's place
 * in a party on the real one.
 */
function identity(origin: string) {
  const who = me();
  if (!who) return null;
  const secret = deviceSecret();
  const id = (label: string) =>
    createHmac('sha256', secret)
      .update(`${label}|${origin}`)
      .digest('hex')
      .slice(0, 32);
  return {
    userId: id('user'),
    deviceId: id('device'),
    displayName: who.name,
    avatarUrl: who.imageUrl ?? undefined,
  };
}

const enabled = () => readSettings().partyEnabled;

/** What the drawer shows as an invite's host: its server, or the computer. */
function inviteHost(held: NonNullable<typeof invite>): string {
  return held.peer
    ? `a computer · ${safetyNumber(held.peer.peer)}`
    : hostOf(held.server ?? server());
}

export function partyState(): PartyState {
  const other = !!invite?.server && invite.server !== server();
  const onHelper =
    !!helper && !!session.code && session.server === helper.origin;
  const hosting = onHelper && helper?.mode === 'host';
  return {
    ...session,
    busy: session.busy || starting,
    error: refusal ?? session.error,
    me: me(),
    invite: invite && {
      code: invite.code,
      host: inviteHost(invite),
      kind: invite.peer ? 'p2p' : 'server',
      safety: invite.peer ? safetyNumber(invite.peer.peer) : null,
      otherRelay:
        invite.peer?.relay && invite.peer.relay !== WAVEBIT_RELAY
          ? invite.peer.relay
          : null,
      otherServer: other,
      preview: invite.preview,
    },
    serverHost: onHelper
      ? 'this party’s computer'
      : hostOf(session.server ?? server()),
    p2pAvailable: helperPath() !== null,
    p2p:
      onHelper && helper
        ? {
            hosting,
            safety: safetyNumber(helper.hostPeer),
            direct: helper.links.direct,
            relayed: helper.links.relayed,
          }
        : null,
    inviteLink:
      hosting && helper && session.code
        ? p2pLink(
            session.code,
            helper.peerId,
            helper.partyKey,
            helper.relay,
            WAVEBIT_RELAY,
          )
        : null,
  };
}

function announce(): void {
  emit(Events.partyChanged, partyState());
}

function refuse(code: string): void {
  refusal = { code, message: '' };
  announce();
}

/**
 * Holds an invite. On this device's own server it asks who is in the party.
 * On any other it asks nothing: a link is anything anyone can send, and even a
 * preview would tell that server this device's address before a press.
 */
function hold(
  code: string,
  named: string | null,
  ask: boolean,
  peer: NonNullable<typeof invite>['peer'] = null,
): void {
  const held = {
    code,
    server: named,
    ask,
    preview: null as PartyPreview | null,
    since: Date.now(),
    peer,
  };
  invite = held;
  refusal = null;
  // Someone's computer, or another server: nothing is sent before a press.
  if (peer || (named && named !== server())) return;
  // napi types an async task's result as unknown; this is the Rust PartyPreview or null.
  void (
    native().partyPreview(
      named ?? server(),
      code,
    ) as Promise<NativePreview | null>
  )
    .then((found) => {
      if (invite !== held || !found) return;
      held.preview = {
        hostName: found.hostName,
        maxMembers: found.maxMembers,
        isFull: found.isFull,
        members: found.members.map((m) => ({
          displayName: m.displayName,
          avatarUrl: m.avatarUrl ?? null,
          isHost: m.isHost,
        })),
      };
      announce();
    })
    .catch(() => {});
}

/**
 * Joins the waiting invite when nothing stands in the way: it was typed here
 * (not a link), it is on this device's own server, and there is a name to
 * join as. Anything else waits for a press in the drawer.
 */
function settle(): void {
  if (!invite) return;
  const who = identity(server());
  const other =
    !!invite.peer || (!!invite.server && invite.server !== server());
  if (who && !other && !invite.ask) {
    const { code } = invite;
    invite = null;
    party().join(server(), code, who);
  }
  announce();
}

export function setPartyMe(next: PartyMe | null): void {
  account = next;
  settle();
  announce();
}

export function createParty(autoplay: boolean): void {
  if (!enabled()) return refuse('off');
  if (!me()) return refuse('no_name');
  // Host on this device: the party runs on this computer.
  if (readSettings().partyHostHere && helperPath()) {
    const relay = relayAddress();
    if (!relay) return refuse('no_relay');
    void throughHelper(
      {
        mode: 'host',
        partyKey: newSecret(16),
        relay,
        direct: readSettings().partyDirect,
      },
      (origin) => {
        const who = identity(origin);
        if (who) party().create(origin, who, autoplay);
      },
    );
    return;
  }
  const who = identity(server());
  if (!who) return refuse('no_name');
  refusal = null;
  party().create(server(), who, autoplay);
}

/** The invite's peer, from what the Rust module read in a link. */
const peerOf = (parsed: {
  peer?: string | null;
  key?: string | null;
  relay?: string | null;
}) =>
  parsed.peer && parsed.key
    ? { peer: parsed.peer, key: parsed.key, relay: parsed.relay ?? null }
    : null;

/** A typed code or a pasted link. */
export function joinParty(text: string): void {
  if (!enabled()) return refuse('off');
  const parsed = native().partyParseInvite(text);
  if (!parsed) return refuse('bad_code');
  if (doorShut(parsed.code)) return refuse('removed');
  hold(parsed.code, parsed.server ?? null, false, peerOf(parsed));
  settle();
}

/** A press on Join, for the invite the drawer showed. */
export function acceptInvite(shown: { code: string; host: string }): void {
  if (!invite || !enabled()) return;
  const target = invite.server ?? server();
  // A link that arrived since the drawer drew this one can't take its place.
  if (shown.code !== invite.code || shown.host !== inviteHost(invite))
    return refuse('invite_changed');
  if (Date.now() - invite.since < 700) return;
  if (invite.peer) return joinComputer(invite.code, invite.peer);
  const who = identity(target);
  if (!who) return refuse('no_name');
  const { code } = invite;
  invite = null;
  refusal = null;
  party().join(target, code, who);
  announce();
}

/** Joins a party on someone's computer through a helper of this computer's own. */
function joinComputer(
  code: string,
  peer: NonNullable<NonNullable<typeof invite>['peer']>,
): void {
  if (!helperPath()) return refuse('helper_missing');
  if (!me()) return refuse('no_name');
  const relay = peer.relay ?? relayAddress();
  if (!relay) return refuse('no_relay');
  invite = null;
  void throughHelper(
    {
      mode: 'join',
      partyKey: peer.key,
      hostPeer: peer.peer,
      relay,
      direct: readSettings().partyDirect,
    },
    (origin) => {
      const who = identity(origin);
      if (who) party().join(origin, code, who);
    },
  );
}

export function declineInvite(): void {
  invite = null;
  announce();
}

export function leaveParty(): void {
  refusal = null;
  core?.leave(0);
}

export function controlParty(control: PartyControl): void {
  if (session.code) party().control(JSON.stringify(control));
}

export function resyncParty(): void {
  if (session.code) core?.sync();
}

export function reactParty(reaction: PartyReactionId): void {
  if (session.code && session.reactions && enabled()) core?.react(reaction);
}

/**
 * A reaction the Rust module checked: from someone in the party, on a server
 * that passes them on, shown once. Others' only show when Settings says so.
 */
function passReaction(reaction: PartyReaction): void {
  if (!enabled() || !session.code) return;
  if (!(PARTY_REACTIONS as readonly string[]).includes(reaction.reaction))
    return;
  if (!reaction.mine && !readSettings().partyShowReactions) return;
  emit(Events.partyReaction, reaction);
}

export function probeParty(): Promise<PartyProbe> {
  // napi types an async task's result as unknown; this is the Rust PartyProbe.
  return (native().partyProbe(server()) as Promise<NativeProbe>).then((p) => ({
    ok: p.ok,
    roundTripMs: p.roundTripMs,
    parties: p.parties ?? null,
    members: p.members ?? null,
    reactions: p.reactions,
  }));
}

/** The invite link among a launch's arguments, if it was started by one. */
export const inviteIn = (argv: readonly string[]) =>
  argv.find((arg) => arg.startsWith(LINK));

/** A `wavebit://party/CODE` link the system handed over. Anything else is ignored. */
export function openInvite(link: string): void {
  if (!link.startsWith(LINK)) return;
  const parsed = native().partyParseInvite(link);
  if (!parsed) return;
  // The page says it is off, and where to turn it on.
  if (!enabled()) return refuse('off');
  if (doorShut(parsed.code)) {
    emit(Events.partyOpen, null);
    return refuse('removed');
  }
  hold(parsed.code, parsed.server ?? null, true, peerOf(parsed));
  emit(Events.partyOpen, null);
  announce();
}

/** Gives the place back before the app goes, so the party isn't left a ghost. */
export function leavePartyOnQuit(): void {
  if (session.code) core?.leave(1_000);
  stopHelper();
}

/**
 * Once per install: one that predates the server choice keeps the server it
 * was using, so codes its friends share keep working. A new install starts on
 * wavebit's (the setting's default).
 */
function settleServerChoice(): void {
  if (store().get('serverMigrated')) return;
  const { setupStep, partyServer } = readSettings();
  const typed = native().partyCleanServer(partyServer);
  if (typed)
    writeSettings({
      partyServerChoice:
        typed === BITCHORD_PARTY_SERVER ? 'bitchord' : 'custom',
    });
  else if (setupStep >= 4) writeSettings({ partyServerChoice: 'bitchord' });
  store().set('serverMigrated', true);
}

export function startParty(): void {
  settleServerChoice();
  // A new name or server in Settings: the drawer shows it, and a waiting invite may now go ahead.
  onSettingsChange(() => {
    // Switched off: out of the party, and nothing left waiting.
    if (!enabled()) {
      invite = null;
      if (session.code) core?.leave(0);
      stopHelper();
    } else if (refusal?.code === 'off') refusal = null;
    settle();
    announce();
  });
}
