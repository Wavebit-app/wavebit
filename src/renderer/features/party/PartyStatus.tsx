import { Button, Tooltip } from '@heroui/react';
import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PartyMember } from '../../../shared/schemas/party';
import { IconAction } from '../../design/IconAction';
import { useSettings } from '../../lib/queries';
import { BREAKPOINTS, useWindowWidth } from '../../lib/useBreakpoint';
import { inOrder, MemberAvatar, useLink, usePartyEnabled } from './PartyBits';
import { openPartyDrawer, useParty } from './store';

/** As large as the account circles beside it. */
const AVATAR = 32;
/** Past this many, the rest fold into a count. */
const SHOWN = 4;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right break-all text-foreground tabular-nums">
        {children}
      </dd>
    </>
  );
}

function Ping() {
  const link = useLink();
  const synced = useParty((s) => s.clockSynced);
  const trip = useParty((s) => s.roundTripMs);
  const offset = useParty((s) => s.offsetMs);
  const code = useParty((s) => s.code);
  const host = useParty((s) => s.serverHost);
  const members = useParty((s) => s.members.length);
  const max = useParty((s) => s.maxMembers);
  return (
    <Tooltip delay={250} closeDelay={0}>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          aria-label={`Listen together connection: ${link.text}`}
          onPress={openPartyDrawer}
          className={`h-7 gap-1.5 rounded-full bg-surface px-2.5 text-xs font-semibold tabular-nums ${link.warn ? 'text-warning' : ''}`}
        >
          <span aria-hidden className={`size-2 rounded-full ${link.dot}`} />
          {link.text}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom end" offset={10} className="p-3">
        <div className="flex w-56 flex-col gap-2 text-left">
          <span className="text-sm font-semibold text-foreground">
            {link.warn ? 'Reconnecting' : synced ? 'In sync' : 'Measuring'}
          </span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {synced && <Fact label="Round trip">{trip} ms</Fact>}
            {synced && (
              <Fact label="Clock offset">
                {offset > 0 ? '+' : ''}
                {offset} ms
              </Fact>
            )}
            <Fact label="Listening">
              {members} of {max}
            </Fact>
            <Fact label="Party">{code}</Fact>
            <Fact label="Server">{host}</Fact>
          </dl>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

function Listener({ member, you }: { member: PartyMember; you: boolean }) {
  const role = member.isHost ? 'Host' : 'Listening';
  const line = member.connected ? role : 'Reconnecting';
  return (
    <Tooltip delay={250} closeDelay={0}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={`${member.displayName}${you ? ' (you)' : ''}: ${line}`}
          onPress={openPartyDrawer}
          style={{ width: AVATAR, height: AVATAR, minWidth: AVATAR }}
          className={`icon-sized relative rounded-full bg-canvas p-0 ring-2 ring-canvas transition-transform hover:z-10 hover:scale-110 focus-visible:z-10 ${member.isHost ? 'z-10 mr-1' : ''}`}
        >
          <MemberAvatar member={member} size={AVATAR} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom end" offset={10} className="p-3">
        <div className="flex w-48 items-center gap-3 text-left">
          <MemberAvatar member={member} size={44} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {member.displayName}
              {you && <span className="font-normal text-muted"> (you)</span>}
            </span>
            <span className="truncate text-xs text-muted">{line}</span>
          </span>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

/**
 * DESIGN.md › Title bar: the Listen together icon, and while in a party the
 * ping and the people listening instead, just before the account circles.
 * All of them open the Listen together drawer.
 */
export function PartyStatus() {
  const code = useParty((s) => s.code);
  const members = useParty((s) => s.members);
  const me = useParty((s) => s.you?.memberId);
  const showPing = useSettings().data?.partyShowPing ?? true;
  const narrow = useWindowWidth() < BREAKPOINTS.expanded;
  const enabled = usePartyEnabled();
  if (!enabled) return null;
  // The player bar is hidden until a song has played, so this is the way in.
  if (!code)
    return (
      <span className="no-drag flex">
        <IconAction label="Listen together" size={32} onPress={openPartyDrawer}>
          <Users size={18} aria-hidden />
        </IconAction>
      </span>
    );
  const ordered = inOrder(members);
  const shown = ordered.slice(0, narrow ? 1 : SHOWN);
  const more = ordered.length - shown.length;
  return (
    <div className="no-drag flex items-center gap-2 pr-1">
      {showPing && <Ping />}
      <div className="isolate flex items-center -space-x-2">
        {shown.map((m) => (
          <Listener key={m.memberId} member={m} you={m.memberId === me} />
        ))}
        {more > 0 && (
          <Button
            variant="ghost"
            aria-label={`${more} more listening`}
            onPress={openPartyDrawer}
            style={{ width: AVATAR, height: AVATAR, minWidth: AVATAR }}
            className="rounded-full bg-surface p-0 text-xs font-semibold text-muted ring-2 ring-canvas"
          >
            +{more}
          </Button>
        )}
      </div>
    </div>
  );
}
