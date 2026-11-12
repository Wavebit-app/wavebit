import { Activity, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PartyProbe } from '../../../shared/schemas/party';
import { DEFAULT_PARTY_SERVER } from '../../../shared/schemas/party';
import { IconAction } from '../../design/IconAction';
import { Segmented } from '../../design/Segmented';
import { count } from '../../lib/format';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import { useParty } from '../party/store';
import { Group, Row, SettingSwitch } from './rows';

const field =
  'h-10 w-64 max-w-full rounded-md bg-sunken px-3 text-sm ring-1 ring-[var(--field-border)] outline-none focus:ring-2 focus:ring-accent';

/** Audio delay moves in these steps, as far as the setting allows. */
const DELAY = { step: 25, max: 500 };

/** A text setting, saved when the field is left or Enter is pressed. */
function TextSetting({
  value,
  onSave,
  ...input
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder: string;
  maxLength: number;
  'aria-label': string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const save = () => text.trim() !== value && onSave(text.trim());
  return (
    <input
      {...input}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && save()}
      spellCheck={false}
      autoComplete="off"
      className={field}
    />
  );
}

/** Settings › Listen together: your name, what the title bar shows, and the server. */
export function PartySection() {
  const settings = useSettings().data;
  const update = useUpdateSettings();
  const me = useParty((s) => s.me);
  const host = useParty((s) => s.serverHost);
  const inParty = useParty((s) => !!s.code);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<PartyProbe | null>(null);
  // An answer is about the address it was asked of.
  useEffect(() => setProbe(null), [settings?.partyServer]);
  if (!settings) return null;

  const check = () => {
    setProbing(true);
    void window.wavebit.party
      .probe()
      .then(setProbe)
      .catch(() =>
        setProbe({ ok: false, roundTripMs: 0, parties: null, members: null }),
      )
      .finally(() => setProbing(false));
  };
  const typed = settings.partyServer.trim();
  // The address in use isn't the one typed: it was refused.
  const refused =
    !inParty &&
    typed !== '' &&
    !typed.toLowerCase().replace(/\/+$/, '').endsWith(host);

  const master = (
    <Group>
      <SettingSwitch
        id="partyEnabled"
        isSelected={settings.partyEnabled}
        onChange={(partyEnabled) => update.mutate({ partyEnabled })}
      />
    </Group>
  );
  if (!settings.partyEnabled) return master;
  const delay = (partyDelayMs: number) =>
    update.mutate({
      partyDelayMs: Math.max(-DELAY.max, Math.min(DELAY.max, partyDelayMs)),
    });

  return (
    <>
      {master}
      <Group title="In a party">
        <Row id="partyPick">
          <Segmented
            label="When I pick a song"
            value={settings.partyPick}
            onChange={(partyPick) => update.mutate({ partyPick })}
            options={[
              { value: 'everyone', label: 'Play for everyone' },
              { value: 'queue', label: 'Add to queue' },
            ]}
          />
        </Row>
        <Row id="partyDelayMs">
          <div className="flex items-center">
            <IconAction
              label={`Later by ${DELAY.step} ms`}
              size={36}
              isDisabled={settings.partyDelayMs <= -DELAY.max}
              onPress={() => delay(settings.partyDelayMs - DELAY.step)}
            >
              <Minus size={18} aria-hidden />
            </IconAction>
            <span className="w-20 text-center font-semibold tabular-nums">
              {settings.partyDelayMs > 0 ? '+' : ''}
              {settings.partyDelayMs} ms
            </span>
            <IconAction
              label={`Earlier by ${DELAY.step} ms`}
              size={36}
              isDisabled={settings.partyDelayMs >= DELAY.max}
              onPress={() => delay(settings.partyDelayMs + DELAY.step)}
            >
              <Plus size={18} aria-hidden />
            </IconAction>
          </div>
        </Row>
      </Group>
      <Group title="You">
        <Row
          id="partyName"
          hint={
            me && !settings.partyName
              ? `Others see “${me.name}”, from your account.`
              : undefined
          }
        >
          <TextSetting
            value={settings.partyName}
            onSave={(partyName) => update.mutate({ partyName })}
            placeholder="Your account’s name"
            maxLength={80}
            aria-label="Name in parties"
          />
        </Row>
        <SettingSwitch
          id="partyShareAvatar"
          isSelected={settings.partyShareAvatar}
          onChange={(partyShareAvatar) => update.mutate({ partyShareAvatar })}
        />
      </Group>
      <Group title="In the app">
        <SettingSwitch
          id="partyShowPing"
          isSelected={settings.partyShowPing}
          onChange={(partyShowPing) => update.mutate({ partyShowPing })}
        />
        <SettingSwitch
          id="partyBanner"
          isSelected={settings.partyBanner}
          onChange={(partyBanner) => update.mutate({ partyBanner })}
        />
        <SettingSwitch
          id="partyNotices"
          isSelected={settings.partyNotices}
          onChange={(partyNotices) => update.mutate({ partyNotices })}
        />
      </Group>
      <Group
        title="Party server"
        footer={`Leave the address empty to use BitChord’s server (${DEFAULT_PARTY_SERVER.replace('https://', '')}), so wavebit and BitChord listeners can share a party. Everyone in a party uses the server it was started on.`}
      >
        <Row
          id="partyServer"
          hint={
            refused
              ? `That address can’t be used; it has to be an https address. Using ${host}.`
              : undefined
          }
        >
          <TextSetting
            value={settings.partyServer}
            onSave={(partyServer) => update.mutate({ partyServer })}
            placeholder={DEFAULT_PARTY_SERVER.replace('https://', '')}
            maxLength={200}
            aria-label="Party server address"
          />
          <IconAction
            label="Check the server"
            size={36}
            isPending={probing}
            onPress={check}
          >
            <Activity size={20} aria-hidden />
          </IconAction>
        </Row>
        {probe && (
          <div
            role="status"
            className="flex min-h-12 items-center gap-4 px-4 pb-2 text-sm"
          >
            <span className="flex-1 text-muted">
              {probe.ok
                ? probe.parties !== null && probe.members !== null
                  ? `${host} answers. ${count(probe.parties, 'party', 'parties')} and ${count(probe.members, 'listener')} on it right now.`
                  : `${host} answers.`
                : `${host} didn’t answer as a party server.`}
            </span>
            <span
              className={`font-semibold tabular-nums ${probe.ok ? 'text-success' : 'text-danger'}`}
            >
              {probe.ok ? `${probe.roundTripMs} ms` : 'No answer'}
            </span>
          </div>
        )}
      </Group>
    </>
  );
}
