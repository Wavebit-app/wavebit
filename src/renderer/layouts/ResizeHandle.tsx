import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  previewColumn,
  resetColumn,
  setColumn,
  type Column,
} from './useColumns';

const STEP = 16;
const BIG_STEP = 64;

/**
 * DESIGN.md › Layout › Resizing: the edge of a side column, after the ARIA
 * window splitter pattern. Nothing shows until the pointer rests on it (no
 * dividers), then a 2px `accent` line. The pointer is captured, so a drag
 * carries on over the video. Arrow keys move it, Home and End go to the
 * limits, Enter or a double click returns to the first width.
 */
export function ResizeHandle({
  column,
  label,
  value,
  min,
  max,
  grow,
}: {
  column: Column;
  label: string;
  value: number;
  min: number;
  max: number;
  /** 1 when dragging right widens the column, -1 when dragging left does. */
  grow: 1 | -1;
}) {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const limit = (width: number) =>
    Math.round(Math.max(min, Math.min(width, max)));

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { last } = drag.current;
    drag.current = null;
    setDragging(false);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setColumn(column, last);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = limit(value - step * grow);
    else if (e.key === 'ArrowRight') next = limit(value + step * grow);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter') {
      e.preventDefault();
      resetColumn(column);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setColumn(column, next);
  };

  return (
    <div className="relative z-20 w-[8px] shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onKeyDown={onKeyDown}
        onDoubleClick={() => resetColumn(column)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, width: value, last: value };
          setDragging(true);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const width = limit(
            drag.current.width + (e.clientX - drag.current.x) * grow,
          );
          drag.current.last = width;
          previewColumn(column, width);
          e.currentTarget.setAttribute('aria-valuenow', String(width));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        className="no-drag group absolute inset-0 cursor-col-resize touch-none outline-none"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-[3px] w-0.5 rounded-full bg-accent opacity-0 transition-opacity delay-200 duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[dragging]:opacity-100 group-data-[dragging]:delay-0"
        />
      </div>
    </div>
  );
}
