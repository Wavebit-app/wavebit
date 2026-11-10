import { Alert, Button, ProgressBar, Tooltip } from '@heroui/react';
import { Check, Folder, FolderPlus, X } from 'lucide-react';
import { useState } from 'react';
import type { AddFolderResult } from '../../../shared/schemas/library';
import { menuOn } from '../../design/ContextMenu';
import { IconTile } from '../../design/IconTile';
import { count } from '../../lib/format';
import { folderMenu } from '../menus/menus';
import {
  useAddFolder,
  useLibraryState,
  useRemoveFolder,
  useScanProgress,
} from '../../lib/queries';

const REFUSALS: Record<
  Exclude<AddFolderResult, { ok: true }>['reason'],
  string | null
> = {
  cancelled: null,
  root: 'That is a whole disk. Choose the folder that holds your music.',
  home: 'That is your whole home folder. Choose the folder that holds your music, like Music.',
  duplicate: 'That folder is already in your library.',
  limit: 'wavebit reads up to 20 folders. Remove one first.',
};

/**
 * The chosen folders, Add a folder, and reading progress (setup step 1 and
 * Settings › Library). In setup, Add a folder is a large icon above the list.
 */
export function FolderList({
  pill = false,
  tile = false,
}: {
  pill?: boolean;
  tile?: boolean;
}) {
  const state = useLibraryState().data;
  const add = useAddFolder();
  const remove = useRemoveFolder();
  const progress = useScanProgress();
  const [refusal, setRefusal] = useState<string | null>(null);
  const radius = pill ? 'rounded-full' : '';
  const addFolder = () =>
    add.mutate(undefined, {
      onSuccess: (result) =>
        setRefusal(result.ok ? null : REFUSALS[result.reason]),
    });
  const folders = state?.folders.length ?? 0;

  return (
    <div className="flex flex-col">
      {tile && (
        <div className="mb-4 flex">
          <IconTile
            label="Add a folder"
            icon={<FolderPlus size={38} strokeWidth={1.8} aria-hidden />}
            status={
              folders
                ? `${count(folders, 'folder')} added`
                : 'Opens the folder picker'
            }
            isPending={add.isPending}
            onPress={addFolder}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        {state?.folders.map((folder) => {
          const name = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
          return (
            <div
              key={folder}
              onContextMenu={menuOn(() =>
                folderMenu(folder, () => remove.mutate(folder)),
              )}
              className="flex h-14 items-center gap-3"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sunken text-muted"
              >
                <Folder size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{name}</span>
                <span className="truncate text-[0.8667rem] text-muted">
                  {folder}
                </span>
              </span>
              <Tooltip delay={400}>
                <Tooltip.Trigger>
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${name}`}
                    onPress={() => remove.mutate(folder)}
                    className="size-9 min-w-9 text-muted"
                  >
                    <X size={16} />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Remove from library</Tooltip.Content>
              </Tooltip>
            </div>
          );
        })}
      </div>
      {!tile && (
        <Button
          variant="secondary"
          className={`mt-3 self-start ${radius}`}
          isPending={add.isPending}
          onPress={addFolder}
        >
          <FolderPlus size={16} aria-hidden />
          Add a folder
        </Button>
      )}
      {refusal && (
        <Alert status="warning" role="alert" className="mt-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{refusal}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {progress.running ? (
        <ProgressBar
          aria-label="Reading files"
          className="mt-6 gap-2"
          value={progress.total ? (progress.seen / progress.total) * 100 : 0}
        >
          <span className="text-sm tabular-nums">
            Reading{' '}
            <strong className="font-semibold">
              {progress.seen.toLocaleString()}
            </strong>{' '}
            of {count(progress.total, 'file')}
          </span>
          <ProgressBar.Track className="h-1">
            <ProgressBar.Fill className="bg-accent" />
          </ProgressBar.Track>
        </ProgressBar>
      ) : (
        (state?.trackCount ?? 0) > 0 && (
          <p className="mt-6 flex items-center gap-2 text-sm font-semibold tabular-nums">
            <Check size={16} className="text-success" aria-hidden />
            {count(state!.trackCount, 'song')} found
          </p>
        )
      )}
    </div>
  );
}
