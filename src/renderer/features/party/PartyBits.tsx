import { Avatar, Button, Tooltip } from '@heroui/react';
import { ChevronRight, Users } from 'lucide-react';
import type { PartyMember } from '../../../shared/schemas/party';
import { setUi, useUi } from '../../app/ui';
import { useSettings } from '../../lib/queries';
import { pingLevel } from './partyRules';
import { useParty } from './store';

type Face = Pick<
  PartyMember,
  'displayName' | 'avatarUrl' | 'isHost' | 'connected'
>;

/** The host first, then in the order they joined. */
export const inOrder = (members: PartyMember[]) =>
  [...members].sort(
    (a, b) =>
      Number(b.isHost) - Number(a.isHost) || a.joinedAtMs - b.joinedAtMs,
  );

/**
 * A listener's picture, or their initial when they share none (or it can't
 * load). The host wears a green ring; the word Host is said wherever there is
 * room for it, since a ring is colour alone.
 */
export function MemberAvatar({ member, size }: { member: Face; size: number }) {
  return (
    <Avatar
      style={{ width: size, height: size }}
      className={`shrink-0 ${member.isHost ? 'outline-2 outline-offset-2 outline-success' : ''} ${member.connected ? '' : 'opacity-45'}`}
    >
      {member.avatarUrl && (
        <Avatar.Image
          src={member.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <Avatar.Fallback className="bg-accent-soft text-[0.8em] font-semibold text-accent">
        {member.displayName.trim().slice(0, 1).toUpperCase() || '?'}
      </Avatar.Fallback>
    </Avatar>
  );
}

/** Pictures overlapping in a row, the host's ring on top. */
export function AvatarStack({
  members,
  size = 28,
  gap = 'ring-surface',
}: {
  members: Face[];
  size?: number;
  /** The ring between the circles, in the colour of what is behind them. */
  gap?: string;
}) {
  return (
    <span className="isolate flex items-center -space-x-2">
      {members.map((m, i) => (
        <span
          key={i}
          className={`relative flex rounded-full ring-2 ${gap} ${m.isHost ? 'z-10 mr-1' : ''}`}
        >
          <MemberAvatar member={m} size={size} />
        </span>
      ))}
    </span>
  );
}

const DOT: Record<ReturnType<typeof pingLevel>, string> = {
  good: 'bg-success',
  slow: 'bg-warning',
  poor: 'bg-danger',
};

/** The connection in a few words, and the dot that goes with it. */
export function useLink(): { text: string; dot: string; warn: boolean } {
  const connection = useParty((s) => s.connection);
  const synced = useParty((s) => s.clockSynced);
  const trip = useParty((s) => s.roundTripMs);
  if (connection !== 'live')
    return {
      text: 'Reconnecting…',
      dot: 'ring-2 ring-warning ring-inset',
      warn: true,
    };
  if (!synced) return { text: 'Syncing', dot: 'bg-faint', warn: false };
  return { text: `${trip} ms`, dot: DOT[pingLevel(trip)], warn: false };
}

/** Settings › Listen together's first switch: off, none of it shows. */
export const usePartyEnabled = (): boolean =>
  useSettings().data?.partyEnabled ?? true;

/**
 * The Listen together icon. In a party it turns accent and the number of
 * people listening, you included, sits beside it.
 */
export function PartyButton({
  size = 32,
  icon = 18,
  onlyInParty = false,
  className = '',
  onOpen,
}: {
  size?: number;
  icon?: number;
  /** Shown only while in a party (the mini player has no room otherwise). */
  onlyInParty?: boolean;
  className?: string;
  /** Runs before the drawer opens, to get out of its way. */
  onOpen?: () => void;
}) {
  const count = useParty((s) => (s.code ? s.members.length : 0));
  const open = useUi((s) => s.panel === 'party');
  const enabled = usePartyEnabled();
  if (!enabled || (onlyInParty && count === 0)) return null;
  const label = open
    ? 'Close Listen together'
    : count
      ? `Listen together: ${count} listening`
      : 'Listen together';
  return (
    <Tooltip delay={600}>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          aria-label={label}
          aria-pressed={open || undefined}
          onPress={() => {
            onOpen?.();
            setUi({ panel: open ? null : 'party' });
          }}
          style={{ height: size, minWidth: size }}
          className={`icon-sized gap-1.5 rounded-md px-1.5 text-sm font-semibold tabular-nums ${open || count ? 'text-accent' : 'text-foreground'} ${className}`}
        >
          <Users size={icon} aria-hidden />
          {count > 0 && count}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Now playing's line about the party: who is in it, and the way to its drawer. */
export function PartyStrip() {
  const code = useParty((s) => s.code);
  const members = useParty((s) => s.members);
  const link = useLink();
  if (!code) return null;
  return (
    <button
      type="button"
      onClick={() => setUi({ panel: 'party' })}
      aria-label={`In party ${code} with ${members.length} listening. Open Listen together`}
      className="flex min-h-14 w-full shrink-0 items-center gap-3 rounded-md bg-foreground/5 py-2 pr-2 pl-4 text-left"
    >
      <AvatarStack members={inOrder(members).slice(0, 3)} size={26} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          In a party · {code}
        </span>
        <span className="truncate text-[0.8667rem] text-muted tabular-nums">
          {members.length} listening · {link.text}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
    </button>
  );
}
