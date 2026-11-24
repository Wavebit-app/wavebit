import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Events } from '../../../shared/ipc/channels';
import type { DiscordStatus } from '../../../shared/schemas/discord';
import { IconAction } from '../../design/IconAction';
import { Segmented } from '../../design/Segmented';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import { Group, Row, SettingSwitch } from './rows';

const statusText: Record<DiscordStatus, string> = {
  disabled: 'Presence is off.',
  not_configured: 'This Wavebit build has no Discord application configured.',
  connecting: 'Looking for a compatible Discord client…',
  connected: 'Connected to a Discord RPC client.',
  waiting:
    'No Discord RPC client responded yet. Wavebit checks Discord, Vesktop and other compatible clients and keeps retrying. In Vesktop, make sure “Rich Presence via arRPC” is enabled.',
  error:
    'Discord RPC could not start. Check the client settings, then reconnect.',
};

export function DiscordSection() {
  const settings = useSettings().data;
  const update = useUpdateSettings();
  const [status, setStatus] = useState<DiscordStatus>('disabled');

  useEffect(() => {
    let alive = true;
    const unsubscribe = window.wavebit.on(Events.discordStatus, setStatus);
    void window.wavebit.discord
      .status()
      .then((next) => alive && setStatus(next))
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!settings) return null;
  const enabled = settings.discordPresenceEnabled;

  return (
    <>
      <Group title="Discord Rich Presence">
        <SettingSwitch
          id="discordPresenceEnabled"
          isSelected={enabled}
          onChange={(discordPresenceEnabled) =>
            update.mutate({ discordPresenceEnabled })
          }
        />
        <div className="flex min-h-14 items-center gap-3 px-4 py-2 text-sm text-muted">
          <span role="status" aria-live="polite" className="flex-1">
            {statusText[status]}
          </span>
          {enabled && status !== 'connected' && status !== 'not_configured' && (
            <IconAction
              label="Reconnect Discord"
              size={34}
              onPress={() => void window.wavebit.discord.retry()}
            >
              <RefreshCw size={17} aria-hidden />
            </IconAction>
          )}
        </div>
      </Group>
      {enabled && (
        <>
          <Group title="What Discord shows">
            <Row id="discordActivityType">
              <Segmented
                label="Activity type"
                value={settings.discordActivityType}
                onChange={(discordActivityType) =>
                  update.mutate({ discordActivityType })
                }
                options={[
                  { value: 'listening', label: 'Listening' },
                  { value: 'playing', label: 'Playing' },
                  { value: 'watching', label: 'Watching' },
                  { value: 'competing', label: 'Competing' },
                ]}
              />
            </Row>
            <SettingSwitch
              id="discordShowAlbum"
              isSelected={settings.discordShowAlbum}
              onChange={(discordShowAlbum) =>
                update.mutate({ discordShowAlbum })
              }
            />
            <SettingSwitch
              id="discordShowArtwork"
              isSelected={settings.discordShowArtwork}
              onChange={(discordShowArtwork) =>
                update.mutate({ discordShowArtwork })
              }
            />
            <SettingSwitch
              id="discordShowProgress"
              isSelected={settings.discordShowProgress}
              onChange={(discordShowProgress) =>
                update.mutate({ discordShowProgress })
              }
            />
          </Group>
          <p className="mt-2 px-4 text-sm leading-normal text-muted">
            Wavebit sends track, artist and optional album details to the
            Compatible Discord client on this computer, such as Discord or
            Vesktop. It does not sign in to Discord or change your online
            status. Cover art is shared only when it has a supported public
            HTTPS image URL.
          </p>
        </>
      )}
    </>
  );
}
