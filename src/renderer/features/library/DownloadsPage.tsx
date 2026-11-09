import { Alert, Button, toast } from '@heroui/react';
import { FolderOpen, Shuffle, Trash2, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { LocalTrack } from '../../../shared/schemas/library';
import { Empty } from '../../design/Empty';
import { IconAction, PlayAction } from '../../design/IconAction';
import { PageHeader } from '../../design/PageHeader';
import { Segmented } from '../../design/Segmented';
import { count, length } from '../../lib/format';
import { useDeleteDownloaded, useDownloaded } from '../../lib/queries';
import { fromLocal, player } from '../player/player';
import { albumsOf, artistsOf, matching } from './downloadGroups';
import { Filter } from './Filter';
import { SongTable } from './SongList';
import { AlbumTile, ArtistTile, GRID } from './Tiles';

type View = 'songs' | 'artists' | 'albums';
const SOURCE = 'Downloads';

/** DESIGN.md › Library › Downloads: the songs wavebit saved, on their own. */
export function DownloadsPage({ compact }: { compact: boolean }) {
  const { data } = useDownloaded();
  const remove = useDeleteDownloaded();
  const [view, setView] = useState<View>('songs');
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<LocalTrack | null>(null);
  const query = useDeferredValue(filter.trim());

  const all = useMemo(() => data?.tracks ?? [], [data]);
  const shown = useMemo(() => matching(all, query), [all, query]);
  const playable = useMemo(() => shown.map(fromLocal), [shown]);
  const albums = useMemo(() => albumsOf(shown), [shown]);
  const artists = useMemo(() => artistsOf(shown), [shown]);
  const totalMs = all.reduce((sum, t) => sum + t.durationMs, 0);

  const confirmDelete = (track: LocalTrack) => {
    setDeleting(null);
    remove.mutate(track.id, {
      onSuccess: () => toast(`“${track.title}” moved to the Trash`),
      onError: () => toast(`Couldn’t delete “${track.title}”`),
    });
  };

  const header = (
    <PageHeader
      title="Downloads"
      meta={
        data ? `${count(all.length, 'song')} · ${length(totalMs, true)}` : ' '
      }
    >
      <div className="flex items-center gap-1">
        {all.length > 0 && (
          <>
            <PlayAction onPress={() => player.playList(playable, 0, SOURCE)} />
            <IconAction
              label="Shuffle"
              onPress={() => player.shuffleList(playable, SOURCE)}
            >
              <Shuffle size={24} aria-hidden />
            </IconAction>
          </>
        )}
        <Button
          variant="secondary"
          className="ml-1"
          onPress={() => void window.wavebit.downloads.openFolder()}
        >
          <FolderOpen size={16} aria-hidden />
          Open folder
        </Button>
      </div>
    </PageHeader>
  );

  if (data && all.length === 0)
    return (
      <>
        {header}
        <Empty art="folder" title="No downloads yet">
          Right-click a song or album from Spotify or YouTube Music and choose
          Download. It shows up here.
        </Empty>
      </>
    );

  const nothing =
    query &&
    (view === 'songs'
      ? shown.length === 0
      : view === 'albums'
        ? albums.length === 0
        : artists.length === 0);

  return (
    <>
      {header}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          fullWidth={compact}
          options={[
            { value: 'songs', label: 'Songs' },
            { value: 'artists', label: 'Artists' },
            { value: 'albums', label: 'Albums' },
          ]}
        />
        {!compact && (
          <Filter
            value={filter}
            onChange={setFilter}
            label="Filter downloads"
          />
        )}
      </div>

      {deleting && (
        <Alert status="danger" className="mt-4 items-center">
          <Alert.Content>
            <Alert.Title>Delete “{deleting.title}”?</Alert.Title>
            <Alert.Description>
              It goes to the Trash, and you can download it again.
            </Alert.Description>
          </Alert.Content>
          <div className="flex shrink-0">
            <IconAction
              label="Move to Trash"
              size={44}
              className="text-danger!"
              onPress={() => confirmDelete(deleting)}
            >
              <Trash2 size={24} aria-hidden />
            </IconAction>
            <IconAction
              label="Keep the file"
              size={44}
              onPress={() => setDeleting(null)}
            >
              <X size={24} aria-hidden />
            </IconAction>
          </div>
        </Alert>
      )}

      <div className="mt-5">
        {nothing ? (
          <Empty art="search" title={`Nothing matches “${query}”`} size={72}>
            Check the spelling.
          </Empty>
        ) : view === 'songs' ? (
          <SongTable
            tracks={shown}
            total={shown.length}
            sort="recent"
            source={SOURCE}
            onDelete={setDeleting}
          />
        ) : view === 'albums' ? (
          <div className={GRID}>
            {albums.map((a) => (
              <AlbumTile key={a.key} album={a} />
            ))}
          </div>
        ) : (
          <div className={GRID}>
            {artists.map((a) => (
              <ArtistTile key={a.name} artist={a} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
