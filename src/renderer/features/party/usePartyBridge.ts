import { toast } from '@heroui/react';
import { useEffect } from 'react';
import type { PartyMember } from '../../../shared/schemas/party';
import {
  useGoogleAccount,
  useSettings,
  useSpotifyStatus,
  useYtOAuth,
  useYtStatus,
} from '../../lib/queries';
import { currentUi, setUi } from '../../app/ui';
import { configurePartySync, startPartySync } from './partySync';
import { faultMessage } from './partyRules';
import { connectParty, partyNow, watchParty } from './store';

/** Only a picture everyone can load goes to the party. */
const shareable = (url: string | null | undefined) =>
  url?.startsWith('https://') && url.length <= 1000 ? url : null;

/** What changed between two member lists, in the words of a notice. */
function notices(
  before: PartyMember[],
  after: PartyMember[],
  me: string | undefined,
): string[] {
  const was = new Map(before.map((m) => [m.memberId, m]));
  const now = new Set(after.map((m) => m.memberId));
  const out: string[] = [];
  for (const m of after) {
    if (m.memberId === me) continue;
    const old = was.get(m.memberId);
    if (!old) out.push(`${m.displayName} joined`);
    else if (!old.isHost && m.isHost)
      out.push(`${m.displayName} is now the host`);
  }
  for (const m of before)
    if (!now.has(m.memberId) && m.memberId !== me)
      out.push(`${m.displayName} left`);
  return out;
}

/**
 * Listen together's wiring, mounted once in the shell: follows the main
 * process's party state, binds it to the player, tells the main process who
 * this listener is, and says when people come and go.
 */
export function usePartyBridge(): void {
  useEffect(() => {
    const stops = [connectParty(), startPartySync()];
    return () => stops.forEach((stop) => stop());
  }, []);

  // The name and picture to join as: YouTube Music's first (it is BitChord's too), then Spotify's.
  const google = useGoogleAccount(!!useYtOAuth().data?.signedIn).data;
  const yt = useYtStatus().data;
  const spotify = useSpotifyStatus().data;
  const ytAccount = yt?.state === 'signed_in' ? yt.account : null;
  const profile = spotify?.state === 'signed_in' ? spotify.profile : null;
  const name = (google?.name ?? ytAccount?.name ?? profile?.name)?.trim();
  const image = shareable(
    google?.imageUrl ?? ytAccount?.imageUrl ?? profile?.imageUrl,
  );
  useEffect(() => {
    void window.wavebit.party
      .setMe(name ? { name: name.slice(0, 80), imageUrl: image } : null)
      .catch(() => {});
  }, [name, image]);

  const settings = useSettings().data;
  const pick = settings?.partyPick ?? 'everyone';
  const delayMs = settings?.partyDelayMs ?? 0;
  useEffect(() => configurePartySync({ pick, delayMs }), [pick, delayMs]);

  // Switched off in Settings: its drawer goes too.
  const enabled = settings?.partyEnabled ?? true;
  useEffect(() => {
    if (!enabled && currentUi().panel === 'party') setUi({ panel: null });
  }, [enabled]);

  const wanted = settings?.partyNotices ?? true;
  useEffect(() => {
    let before = partyNow();
    return watchParty(() => {
      const now = partyNow();
      const was = before;
      before = now;
      // Being removed, or the party ending, is said even with notices off.
      if (was.code && !now.code && now.error) toast(faultMessage(now.error));
      // An invite link arrived while Listen together is off: there is no drawer to say so.
      if (now.error?.code === 'off' && was.error?.code !== 'off')
        toast(faultMessage(now.error));
      if (!wanted || !was.code || was.code !== now.code) return;
      if (was.members === now.members) return;
      for (const line of notices(was.members, now.members, now.you?.memberId))
        toast(line);
    });
  }, [wanted]);
}
