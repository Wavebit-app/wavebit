import { AudioWaveform, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { YouTubeMusicMark } from '../../design/BrandMarks';
import { menuOn } from '../../design/ContextMenu';
import { WaveRing } from '../../design/WaveRing';
import { clock } from '../../lib/format';
import { OnDevice, SongArt } from '../downloads/SongArt';
import { useSongDownload } from '../downloads/store';
import { songMenu } from '../menus/menus';
import { usePlayer, type Playable } from '../player/player';

export interface SongRowProps {
  no: number;
  track: Playable | null;
  title: string;
  artist: string;
  album?: string | null;
  extra?: ReactNode;
  durationMs: number;
  artwork?: string | null;
  /** Shown instead of the album: Spotify's "Plays from your files" line. */
  status?: 'matched' | 'stream' | 'missing';
  showArt?: boolean;
  /** False in compact windows: the row still dims, but has no status column. */
  statusColumn?: boolean;
  onPlay: () => void;
  /** Opens the album; Spotify rows link to the matching local album. */
  onAlbum?: () => void;
  /** Each artist as its own link; `open` is null when there's no page to go to. */
  artistLinks?: { name: string; open: (() => void) | null }[];
  /** Opens the song's own page instead of the details sheet. */
  onDetails?: () => void;
  /** A Spotify song's heart, offered in the menu too. */
  saved?: { value: boolean; toggle: () => void };
  /** Library › Downloads: offers Delete file in the menu. */
  onDelete?: () => void;
  columns: string;
}

/**
 * DESIGN.md › Library › List: 6px corners, 4px between rows, the hovered row
 * `sunken`, the playing row in `accent`. No lines. Its actions are in the
 * context menu.
 */
export function SongRow({
  no,
  track,
  title,
  artist,
  album,
  extra,
  durationMs,
  artwork,
  status,
  showArt = true,
  statusColumn = true,
  onPlay,
  onAlbum,
  artistLinks,
  onDetails,
  saved,
  onDelete,
  columns,
}: SongRowProps) {
  const playing = usePlayer(
    (s) => !!track && s.queue[s.index]?.id === track.id,
  );
  const download = useSongDownload(track);
  const downloading =
    download.state === 'queued' || download.state === 'running';
  const missing = status === 'missing';
  const artistPage = artistLinks?.find((a) => a.open)?.open;
  const titleLine = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={`truncate text-sm font-medium ${playing ? 'text-accent' : ''}`}
      >
        {title}
      </span>
      <OnDevice track={track} />
    </span>
  );
  return (
    <div
      role="row"
      tabIndex={missing ? -1 : 0}
      aria-disabled={missing || undefined}
      onDoubleClick={missing ? undefined : onPlay}
      onKeyDown={(e) => !missing && e.key === 'Enter' && onPlay()}
      onContextMenu={menuOn(
        track
          ? () =>
              songMenu(track, {
                onPlay,
                onAlbum,
                onArtist: artistPage ?? undefined,
                onDetails,
                saved,
                onDelete,
              })
          : undefined,
      )}
      style={{ gridTemplateColumns: columns }}
      className="group grid h-[var(--row-h)] items-center gap-4 rounded-md px-3 outline-offset-0 hover:bg-sunken focus-visible:bg-sunken"
    >
      <span
        role="cell"
        className={`flex justify-end text-sm text-muted tabular-nums ${missing ? 'opacity-50' : ''}`}
      >
        {downloading && !showArt ? (
          <span className="relative block size-[22px]">
            <WaveRing
              value={download.fraction}
              live={download.state === 'running'}
              waves={8}
              label={`Downloading ${title}`}
            />
          </span>
        ) : playing ? (
          <AudioWaveform
            size={18}
            className="text-accent"
            aria-label="Playing"
          />
        ) : (
          no
        )}
      </span>
      <span
        role="cell"
        className={`flex min-w-0 items-center gap-3 ${missing ? 'opacity-50' : ''}`}
      >
        {showArt && (
          <SongArt
            track={track}
            src={artwork}
            className="size-[var(--row-art)]"
          />
        )}
        {artistLinks ? (
          <span className="flex min-w-0 flex-col">
            <button
              type="button"
              onClick={onPlay}
              className="flex min-w-0 text-left"
            >
              {titleLine}
            </button>
            <span className="truncate text-[0.8667rem] text-muted">
              {artistLinks.map((a, i) => (
                <span key={`${a.name}-${i}`}>
                  {i > 0 && ', '}
                  {a.open ? (
                    <button
                      type="button"
                      onClick={a.open}
                      className="hover:text-foreground hover:underline"
                    >
                      {a.name}
                    </button>
                  ) : (
                    a.name
                  )}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <button
            type="button"
            onClick={missing ? undefined : onPlay}
            disabled={missing}
            className="flex min-w-0 flex-col text-left"
          >
            {titleLine}
            <span className="truncate text-[0.8667rem] text-muted">
              {artist}
            </span>
          </button>
        )}
      </span>
      {album !== undefined && (
        <span
          role="cell"
          className={`min-w-0 truncate text-sm text-muted ${missing ? 'opacity-50' : ''}`}
        >
          {onAlbum ? (
            <button
              type="button"
              onClick={onAlbum}
              className="max-w-full truncate text-left hover:text-foreground hover:underline"
            >
              {album}
            </button>
          ) : (
            album
          )}
        </span>
      )}
      {status && statusColumn && (
        <span
          role="cell"
          className="flex items-center gap-1.5 text-[0.8667rem] text-muted"
        >
          {status === 'matched' ? (
            <>
              <Check
                size={14}
                strokeWidth={2.5}
                className="text-success"
                aria-hidden
              />
              Plays from your files
            </>
          ) : status === 'stream' ? (
            <>
              <YouTubeMusicMark size={14} />
              Plays from YouTube Music
            </>
          ) : (
            'Not in your library'
          )}
        </span>
      )}
      {extra}
      <span
        role="cell"
        className={`flex justify-end text-sm text-muted tabular-nums ${missing ? 'opacity-50' : ''}`}
      >
        {clock(durationMs)}
      </span>
    </div>
  );
}

export function SongRowSkeleton({ columns }: { columns: string }) {
  return (
    <div
      aria-hidden
      style={{ gridTemplateColumns: columns }}
      className="grid h-[var(--row-h)] items-center gap-4 px-3"
    >
      <span className="h-2.5 w-3.5 justify-self-end rounded-[3px] bg-sunken" />
      <span className="flex items-center gap-3">
        <span className="size-[var(--row-art)] shrink-0 rounded-[4px] bg-sunken" />
        <span className="flex flex-1 flex-col gap-2">
          <span className="h-2.5 w-3/5 rounded-[3px] bg-sunken" />
          <span className="h-2 w-1/3 rounded-[3px] bg-sunken" />
        </span>
      </span>
      <span className="h-2.5 w-1/2 rounded-[3px] bg-sunken" />
      <span className="h-2.5 w-8 justify-self-end rounded-[3px] bg-sunken" />
    </div>
  );
}
