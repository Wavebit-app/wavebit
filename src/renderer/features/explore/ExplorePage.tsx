import { Skeleton } from '@heroui/react';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { YtMood, YtMoodSection } from '../../../shared/schemas/youtube';
import { nav } from '../../app/router';
import { PageHeader } from '../../design/PageHeader';
import { cachedArt } from '../../lib/format';
import { moodTone } from '../../lib/moodTone';
import { useYtCategory, useYtExplore, useSettings } from '../../lib/queries';
import { useSizeClass } from '../../lib/useBreakpoint';
import { YtShelfView } from '../youtube/YouTube';

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(min(220px,calc(50%-6px)),1fr))] gap-3';

function usePagePadding() {
  const compact = useSizeClass() === 'compact';
  return {
    style: { '--page-x': compact ? '1.25rem' : '2.5rem' } as CSSProperties,
    className: compact ? 'px-5 pt-5 pb-10' : 'px-10 pt-8 pb-12',
  };
}

function Retry({ what, retry }: { what: string; retry: () => void }) {
  return (
    <p role="alert" className="mt-8 text-muted">
      YouTube Music didn’t send {what}.{' '}
      <button
        type="button"
        onClick={retry}
        className="font-medium text-accent hover:underline"
      >
        Try again
      </button>
    </p>
  );
}

/**
 * DESIGN.md › Explore: BitChord's mood card. YouTube's colour as a stripe, and
 * the first cover in that category tinted over the rest. The cover is only
 * asked for once the card is near the screen.
 */
function MoodCard({ mood }: { mood: YtMood }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  const shelves = useYtCategory(mood.params, near).data;
  const art = shelves
    ?.flatMap((s) => s.items)
    .find((i) => i.imageUrl)?.imageUrl;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() =>
        nav.go({
          name: 'exploreCategory',
          params: mood.params,
          title: mood.title,
        })
      }
      style={{ backgroundColor: moodTone(mood.color, mood.title) }}
      className="relative isolate block aspect-[1.72] w-full overflow-hidden rounded-[18px] text-left text-white"
    >
      {art && (
        <img
          src={cachedArt(art)}
          alt=""
          draggable={false}
          loading="lazy"
          className="absolute inset-y-0 right-0 h-full w-[72%] object-cover mix-blend-multiply grayscale"
        />
      )}
      <span className="absolute inset-x-3.5 top-3 line-clamp-2 text-[1.1333rem] leading-tight font-bold [text-shadow:0_1px_6px_rgb(0_0_0/0.35)]">
        {mood.title}
      </span>
    </button>
  );
}

function MoodGrid({ section }: { section: YtMoodSection }) {
  return (
    <section aria-label={section.title} className="mt-8">
      <h2 className="mb-3 font-semibold">{section.title}</h2>
      <div className={GRID}>
        {section.items.map((mood) => (
          <MoodCard key={mood.params} mood={mood} />
        ))}
      </div>
    </section>
  );
}

function ExploreSkeleton() {
  return (
    <div className={`mt-8 ${GRID}`}>
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="aspect-[1.72] w-full rounded-[18px]" />
      ))}
    </div>
  );
}

/**
 * DESIGN.md › Explore, after BitChord's ExploreScreen and YouTube Music's own
 * Explore tab: what's new and trending, then the moods and genres.
 */
export function ExplorePage() {
  const explore = useYtExplore();
  const padding = usePagePadding();
  const data = explore.data;
  const [lead, ...shelves] = data?.shelves ?? [];
  const [firstMoods, ...moreMoods] = data?.moods ?? [];
  const hideMoods = useSettings().data?.hideMoods ?? false;
  return (
    <div {...padding}>
      <PageHeader
        title="Explore"
        meta={
          data
            ? `Live from YouTube Music · Updated ${TIME.format(data.fetchedAt)}`
            : 'Live from YouTube Music'
        }
      />
      {explore.isError && !data && (
        <Retry what="Explore" retry={() => void explore.refetch()} />
      )}
      {explore.isPending && <ExploreSkeleton />}
      {lead && <YtShelfView shelf={lead} />}
      {!hideMoods && firstMoods && <MoodGrid section={firstMoods} />}
      {shelves.map((shelf, i) => (
        <YtShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
      ))}
      {!hideMoods &&
        moreMoods.map((section) => (
          <MoodGrid key={section.title} section={section} />
        ))}
    </div>
  );
}

/** One mood or genre: its own shelves of playlists (BitChord's MoodGenrePlaylistsScreen). */
export function ExploreCategoryPage({
  params,
  title,
}: {
  params: string;
  title: string;
}) {
  const category = useYtCategory(params, true);
  const padding = usePagePadding();
  return (
    <div {...padding}>
      <button
        type="button"
        onClick={() => nav.go({ name: 'explore' })}
        className="mb-1.5 inline-flex items-center gap-1 text-[0.8667rem] font-medium text-muted hover:text-foreground"
      >
        <ChevronLeft size={16} aria-hidden />
        Explore
      </button>
      <PageHeader title={title} meta="Playlists on YouTube Music" />
      {category.isError && (
        <Retry what={title} retry={() => void category.refetch()} />
      )}
      {category.isPending && <ExploreSkeleton />}
      {category.data?.map((shelf, i) => (
        <YtShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
      ))}
      {category.data?.length === 0 && (
        <p className="mt-8 text-muted">Nothing here right now.</p>
      )}
    </div>
  );
}
