import { useSyncExternalStore } from 'react';
import { Events } from '../../../shared/ipc/channels';
import {
  DEFAULT_PARTY_SERVER,
  IDLE_PARTY,
  type PartyState,
} from '../../../shared/schemas/party';
import { setUi } from '../../app/ui';

/** The party as the main process reports it. */
let state: PartyState = {
  ...IDLE_PARTY,
  me: null,
  invite: null,
  serverHost: DEFAULT_PARTY_SERVER.replace('https://', ''),
};
const listeners = new Set<() => void>();

function set(patch: Partial<PartyState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** The party right now, for code that isn't drawing it. */
export const partyNow = (): PartyState => state;

export function watchParty(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to one slice; components re-render only when it changes. */
export function useParty<T>(select: (s: PartyState) => T): T {
  return useSyncExternalStore(watchParty, () => select(state));
}

/** The server's clock, read from here; null until the first round trip. */
export const serverNow = (): number | null =>
  state.clockSynced ? Date.now() + state.offsetMs : null;

export const openPartyDrawer = () => setUi({ panel: 'party' });

/** Starts following the main process's party state. Returns the stop. */
export function connectParty(): () => void {
  const stops = [
    window.wavebit.on(Events.partyChanged, set),
    window.wavebit.on(Events.partyOpen, openPartyDrawer),
  ];
  void window.wavebit.party.state().then((first) => {
    set(first);
    // Nothing survives a restart, so any of these means an invite link started wavebit.
    if (first.code || first.busy || first.invite) openPartyDrawer();
  });
  return () => stops.forEach((stop) => stop());
}
