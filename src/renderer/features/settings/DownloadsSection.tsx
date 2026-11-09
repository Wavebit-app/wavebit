import { Alert, Button, toast } from '@heroui/react';
import { useState } from 'react';
import type { DownloadConcurrency } from '../../../shared/schemas/settings';
import { Segmented } from '../../design/Segmented';
import { useDownloadSummary } from '../downloads/store';
import {
  countSongs,
  queueLibrary,
  readWholeLibrary,
  type LibraryPart,
} from '../downloads/lists';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import { Group, Row, SettingSwitch } from './rows';

const FOLDER_REFUSED = {
  root: 'Choose a folder inside a drive, not the whole drive',
  home: 'Choose a folder inside your home folder',
  limit: 'Your library already has 20 folders',
};

/** At most 250 songs start in an hour. */
const hoursFor = (songs: number) => Math.max(1, Math.ceil(songs / 250));

function WholeLibrary() {
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [parts, setParts] = useState<LibraryPart[] | null>(null);
  const count = parts ? countSongs(parts) : 0;

  const read = () => {
    setReading(true);
    void readWholeLibrary()
      .then((found) => {
        if (found.length) setParts(found);
        else toast('Connect Spotify or YouTube Music to download your library');
      })
      .catch(() => toast('Couldn’t read your library'))
      .finally(() => setReading(false));
  };

  const start = () => {
    if (!parts) return;
    setStarting(true);
    void queueLibrary(parts)
      .then((added) =>
        toast(
          added
            ? `Downloading ${added.toLocaleString()} songs`
            : 'Your whole library is already here',
        ),
      )
      .catch(() => toast('Couldn’t start the download'))
      .finally(() => {
        setStarting(false);
        setParts(null);
      });
  };

  return (
    <>
      <Row id="downloadLibrary">
        <Button variant="secondary" isPending={reading} onPress={read}>
          Download all…
        </Button>
      </Row>
      {parts && (
        <Alert status="accent" className="mx-4 mb-3">
          <Alert.Content>
            <Alert.Title>
              Download {count.toLocaleString()} songs from {parts.length}{' '}
              {parts.length === 1 ? 'list' : 'lists'}?
            </Alert.Title>
            <Alert.Description>
              This takes up to about {hoursFor(count)}{' '}
              {hoursFor(count) === 1 ? 'hour' : 'hours'}. It carries on after a
              restart, and songs you already have are skipped.
            </Alert.Description>
          </Alert.Content>
          <div className="flex gap-2">
            <Button size="sm" isPending={starting} onPress={start}>
              Start
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setParts(null)}>
              Not now
            </Button>
          </div>
        </Alert>
      )}
    </>
  );
}

export function DownloadsSection() {
  const s = useSettings().data!;
  const update = useUpdateSettings();
  const { folder } = useDownloadSummary();

  const chooseFolder = async () => {
    const result = await window.wavebit.downloads.chooseFolder();
    if (!result.ok && result.reason !== 'cancelled')
      toast(FOLDER_REFUSED[result.reason]);
  };

  return (
    <>
      <Group title="Where songs go">
        <Row id="downloadFolder" hint={folder}>
          <Button variant="secondary" onPress={() => void chooseFolder()}>
            Change
          </Button>
        </Row>
        <SettingSwitch
          id="downloadOrganise"
          isSelected={s.downloadOrganise}
          onChange={(downloadOrganise) => update.mutate({ downloadOrganise })}
        />
      </Group>
      <Group title="Downloading">
        <Row id="downloadConcurrency">
          <Segmented
            label="Songs at a time"
            value={String(s.downloadConcurrency) as `${DownloadConcurrency}`}
            onChange={(v) =>
              update.mutate({
                downloadConcurrency: Number(v) as DownloadConcurrency,
              })
            }
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ]}
          />
        </Row>
        <SettingSwitch
          id="downloadSkipOwned"
          isSelected={s.downloadSkipOwned}
          onChange={(downloadSkipOwned) => update.mutate({ downloadSkipOwned })}
        />
      </Group>
      <Group title="What goes in the file">
        <SettingSwitch
          id="downloadEmbedCover"
          isSelected={s.downloadEmbedCover}
          onChange={(downloadEmbedCover) =>
            update.mutate({ downloadEmbedCover })
          }
        />
        <SettingSwitch
          id="downloadEmbedLyrics"
          isSelected={s.downloadEmbedLyrics}
          onChange={(downloadEmbedLyrics) =>
            update.mutate({ downloadEmbedLyrics })
          }
        />
      </Group>
      <Group title="Your library">
        <SettingSwitch
          id="downloadSyncLists"
          isSelected={s.downloadSyncLists}
          onChange={(downloadSyncLists) => update.mutate({ downloadSyncLists })}
        />
        <WholeLibrary />
      </Group>
    </>
  );
}
