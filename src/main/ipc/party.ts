import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  PartyAcceptSchema,
  PartyControlSchema,
  PartyCreateSchema,
  PartyJoinSchema,
  PartyMeSchema,
  PartyReactSchema,
} from '../../shared/schemas/party';
import {
  acceptInvite,
  controlParty,
  createParty,
  declineInvite,
  joinParty,
  leaveParty,
  partyState,
  probeParty,
  reactParty,
  resyncParty,
  setPartyMe,
} from '../party/party';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerPartyIpc(): void {
  handle(Channels.partyState, NoInput, () => partyState());
  handle(Channels.partyMe, PartyMeSchema, (me) => setPartyMe(me));
  handle(Channels.partyCreate, PartyCreateSchema, ({ autoplay }) =>
    createParty(autoplay),
  );
  handle(Channels.partyJoin, PartyJoinSchema, ({ text }) => joinParty(text));
  handle(Channels.partyLeave, NoInput, () => leaveParty());
  handle(Channels.partyControl, PartyControlSchema, (control) =>
    controlParty(control),
  );
  handle(Channels.partyAcceptInvite, PartyAcceptSchema, (shown) =>
    acceptInvite(shown),
  );
  handle(Channels.partyDeclineInvite, NoInput, () => declineInvite());
  handle(Channels.partyProbe, NoInput, () => probeParty());
  handle(Channels.partyResync, NoInput, () => resyncParty());
  handle(Channels.partyReact, PartyReactSchema, ({ reaction }) =>
    reactParty(reaction),
  );
}
