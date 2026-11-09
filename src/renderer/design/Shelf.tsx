import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconAction } from './IconAction';

/** What a shelf holds; each kind sets its own column count (index.css › shelves). */
export type ShelfKind = 'picks' | 'listen' | 'square' | 'circle' | 'tracks';

/**
 * A titled row that scrolls sideways (BitChord's ShelfView): the title is a
 * link with a chevron when there's a page behind it, the rows snap to
 * columns, and two bare chevrons at the right of the heading page it by one
 * screen of columns whenever it has more than fits.
 */
export function Shelf({
  title,
  subtitle,
  source,
  onOpen,
  action,
  kind,
  label = title,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where the row comes from, above the title: "Spotify", "YouTube Music". */
  source?: string;
  /** Opens the page behind the title. */
  onOpen?: () => void;
  /** Something on the right of the title, e.g. Library's Show all. */
  action?: ReactNode;
  kind: ShelfKind;
  label?: string;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Rows arrive after the shelf mounts, without changing the list's own size.
  const count = Children.count(children);
  useEffect(measure, [measure, count]);

  const page = (direction: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const pad = parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
    el.scrollBy({ left: direction * (el.clientWidth - pad * 2) });
  };

  return (
    <section aria-label={label} className="shelf mt-8">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          {source && (
            <span className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
              {source}
            </span>
          )}
          <h2 className="text-[1rem] font-semibold">
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                className="group/title inline-flex items-center gap-0.5 rounded-sm text-left"
              >
                {title}
                <ChevronRight
                  size={17}
                  strokeWidth={2.5}
                  aria-hidden
                  className="text-muted group-hover/title:text-foreground"
                />
              </button>
            ) : (
              title
            )}
          </h2>
          {subtitle && (
            <span className="truncate text-sm text-muted">{subtitle}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {!(edges.start && edges.end) && (
            <>
              <IconAction
                label={`Previous ${title}`}
                size={36}
                isDisabled={edges.start}
                onPress={() => page(-1)}
              >
                <ChevronLeft size={26} strokeWidth={2.5} aria-hidden />
              </IconAction>
              <IconAction
                label={`Next ${title}`}
                size={36}
                isDisabled={edges.end}
                onPress={() => page(1)}
              >
                <ChevronRight size={26} strokeWidth={2.5} aria-hidden />
              </IconAction>
            </>
          )}
        </div>
      </div>
      <ul
        ref={list}
        onScroll={measure}
        data-kind={kind}
        className="shelf-list my-0 list-none py-0.5"
      >
        {Children.map(children, (child) => (
          // A grid cell stretches a button to the column; a block would shrink it to fit.
          <li className="grid">{child}</li>
        ))}
      </ul>
    </section>
  );
}

/** Library's "Show all" beside a shelf's title. */
export function ShowAll({ onPress }: { onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="shrink-0 rounded-sm text-sm font-medium text-accent hover:underline"
    >
      Show all
    </button>
  );
}
