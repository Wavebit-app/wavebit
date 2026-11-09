import { Skeleton } from '@heroui/react';
import type { CSSProperties } from 'react';
import { Artwork } from '../../design/Artwork';
import { Backdrop } from '../../design/Backdrop';
import { YouTubeMusicMark } from '../../design/BrandMarks';
import { useYtArtist } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { YtShelfView } from './YouTube';

/**
 * A YouTube Music artist (browse UC…), as BitChord's artist page: the photo
 * in a circle over the backdrop, the name and subscriber count, then the
 * page's own shelves (top songs, albums, singles, videos, fans also like).
 */
export function YtArtistPage({ id }: { id: string }) {
  const artist = useYtArtist(id);
  const compact = useSizeClass() === 'compact';
  const a = artist.data;
  if (artist.isError)
    return (
      <p role="alert" className="px-10 py-8 text-muted">
        YouTube Music didn’t send this artist.{' '}
        <button
          type="button"
          onClick={() => void artist.refetch()}
          className="font-medium text-accent hover:underline"
        >
          Try again
        </button>
      </p>
    );
  return (
    <div>
      <section
        className={`relative flex min-h-[280px] items-end ${compact ? 'px-5' : 'px-10'} pt-10 pb-7`}
      >
        <Backdrop src={a?.imageUrl} />
        <div
          className={`relative flex gap-7 ${compact ? 'flex-col items-start' : 'items-end'}`}
        >
          {a ? (
            <Artwork
              src={a.imageUrl}
              size={compact ? 140 : 180}
              rounded="rounded-full"
            />
          ) : (
            <Skeleton className="size-[180px] rounded-full" />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[0.8667rem] font-medium text-muted">
              <YouTubeMusicMark size={14} />
              YouTube Music artist
            </span>
            <h1 className="text-headline font-semibold tracking-[-0.02em]">
              {a?.name ?? ' '}
            </h1>
            {a?.subscribers && (
              <span className="text-sm text-muted tabular-nums">
                {a.subscribers}
              </span>
            )}
            {a?.description && (
              <p className="line-clamp-3 max-w-[680px] text-muted">
                {a.description}
              </p>
            )}
          </div>
        </div>
      </section>
      <div
        style={{ '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties}
        className={compact ? 'px-5 pb-10' : 'px-10 pb-12'}
      >
        {a?.shelves.map((shelf, i) => (
          <YtShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
        ))}
      </div>
    </div>
  );
}
