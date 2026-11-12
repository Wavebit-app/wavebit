import Store from 'electron-store';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Party,
  PartyPreview as NativePreview,
  PartyProbe as NativeProbe,
} from '../../../native/index';
import { Events } from '../../shared/ipc/channels';
import {
  DEFAULT_PARTY_SERVER,
  IDLE_PARTY,
  type PartyControl,
  type PartyFault,
  type PartyMe,
  type PartyPreview,
  type PartyProbe,
  type PartySession,
  type PartyState,
} from '../../shared/schemas/party';
import { emit } from '../ipc/handle';
import { native } from '../services/native';
import { onSettingsChange, readSettings } from '../services/settings';
import { shut, stillShut } from './doorRules';

/**
 * Listen together, the main process's part: who this device joins as, which
 * server, and invite links. The connection, the clock and the party's state
 * are the Rust module's (`native/src/party`), which also keeps the party
 * token; nothing here ever holds it.
 */

/** The only link type the system may hand over. Pasted links may be BitChord's too. */
const LINK = 'wavebit://';

// Opened on first use, so a test profile set in main.ts applies before the path is read.
let opened: Store<{ deviceId: string; shut: unknown }> | null = null;
const store = () =>
  (opened ??= new Store<{ deviceId: string; shut: unknown }>({
    name: 'party',
    defaults: { deviceId: '', shut: {} },
    clearInvalidConfig: true,
  }));

/** Lets the server give this device its place back after a restart. Random, tied to nothing. */
function deviceId(): string {
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
} | null = null;
/** Something wavebit itself refused, before the server was asked. */
let refusal: PartyFault | null = null;

function party(): Party {
  return (core ??= new (native().Party)((json: string) => {
    const before = session;
    session = JSON.parse(json) as PartySession;
    // Removed by the host: that party's door stays shut to this device for a day.
    if (before.code && !session.code && session.error?.code === 'kicked')
      store().set('shut', shut(store().get('shut'), before.code, Date.now()));
    announce();
  }));
}

/** The server parties are started on: the one in Settings, else BitChord's. */
function server(): string {
  return (
    native().partyCleanServer(readSettings().partyServer) ??
    DEFAULT_PARTY_SERVER
  );
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

function identity() {
  const who = me();
  if (!who) return null;
  const id = deviceId();
  return {
    // A hash, so the device id itself is never what other members' apps hold.
    userId: createHash('sha256').update(id).digest('hex').slice(0, 32),
    deviceId: id,
    displayName: who.name,
    avatarUrl: who.imageUrl ?? undefined,
  };
}

const enabled = () => readSettings().partyEnabled;

export function partyState(): PartyState {
  const other = !!invite?.server && invite.server !== server();
  return {
    ...session,
    error: refusal ?? session.error,
    me: me(),
    invite: invite && {
      code: invite.code,
      host: hostOf(invite.server ?? server()),
      otherServer: other,
      preview: invite.preview,
    },
    serverHost: hostOf(session.server ?? server()),
  };
}

function announce(): void {
  emit(Events.partyChanged, partyState());
}

function refuse(code: string): void {
  refusal = { code, message: '' };
  announce();
}

/** Holds an invite and asks its server who is in the party. */
function hold(code: string, named: string | null, ask: boolean): void {
  const held = {
    code,
    server: named,
    ask,
    preview: null as PartyPreview | null,
  };
  invite = held;
  refusal = null;
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
  const who = identity();
  const other = !!invite.server && invite.server !== server();
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
  const who = identity();
  if (!who) return refuse('no_name');
  refusal = null;
  party().create(server(), who, autoplay);
}

/** A typed code or a pasted link. */
export function joinParty(text: string): void {
  if (!enabled()) return refuse('off');
  const parsed = native().partyParseInvite(text);
  if (!parsed) return refuse('bad_code');
  if (doorShut(parsed.code)) return refuse('removed');
  hold(parsed.code, parsed.server ?? null, false);
  settle();
}

export function acceptInvite(): void {
  if (!invite || !enabled()) return;
  const who = identity();
  if (!who) return refuse('no_name');
  const { code, server: named } = invite;
  invite = null;
  refusal = null;
  party().join(named ?? server(), code, who);
  announce();
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

export function probeParty(): Promise<PartyProbe> {
  // napi types an async task's result as unknown; this is the Rust PartyProbe.
  return (native().partyProbe(server()) as Promise<NativeProbe>).then((p) => ({
    ok: p.ok,
    roundTripMs: p.roundTripMs,
    parties: p.parties ?? null,
    members: p.members ?? null,
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
  hold(parsed.code, parsed.server ?? null, true);
  emit(Events.partyOpen, null);
  announce();
}

/** Gives the place back before the app goes, so the party isn't left a ghost. */
export function leavePartyOnQuit(): void {
  if (session.code) core?.leave(1_000);
}

export function startParty(): void {
  // A new name or server in Settings: the drawer shows it, and a waiting invite may now go ahead.
  onSettingsChange(() => {
    // Switched off: out of the party, and nothing left waiting.
    if (!enabled()) {
      invite = null;
      if (session.code) core?.leave(0);
    } else if (refusal?.code === 'off') refusal = null;
    settle();
    announce();
  });
}
