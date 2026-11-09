import { useEffect, useRef, useState, type RefObject } from 'react';

/** How far the page must be pulled before it refreshes, in px after damping. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
const DAMPING = 0.5;
/** A pause this long between wheel events ends one gesture and starts another. */
const WHEEL_GAP_MS = 200;

/**
 * DESIGN.md › Pull to refresh: pull down from the top of a page to refresh, by
 * scrolling up further on a mouse wheel or touchpad, or by swiping down on a
 * touch screen. A scroll that was already running when it reached the top
 * doesn't count, so coming back up a long page never refreshes it by accident.
 */
export function usePullToRefresh(
  scroller: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
  enabled: boolean,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const allowed = useRef(enabled);
  allowed.current = enabled;

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let distance = 0;
    let busy = false;
    let armed = false;
    let lastWheel = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let touchStart: number | null = null;

    const show = (value: number) => {
      distance = value;
      setPull(value);
    };
    const refresh = () => {
      clearTimeout(idle);
      busy = true;
      show(0);
      setRefreshing(true);
      void latest
        .current()
        .catch(() => {})
        .finally(() => {
          busy = false;
          setRefreshing(false);
        });
    };

    const onWheel = (event: WheelEvent) => {
      const gap = event.timeStamp - lastWheel;
      lastWheel = event.timeStamp;
      if (busy || !allowed.current) return;
      if (gap > WHEEL_GAP_MS) armed = element.scrollTop <= 0;
      if (!armed) return;
      clearTimeout(idle);
      if (event.deltaY >= 0) {
        armed = false;
        show(0);
        return;
      }
      const next = Math.min(PULL_MAX, distance - event.deltaY * DAMPING);
      show(next);
      if (next >= PULL_THRESHOLD) refresh();
      else idle = setTimeout(() => show(0), WHEEL_GAP_MS + 100);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStart =
        !busy && allowed.current && element.scrollTop <= 0
          ? (event.touches[0]?.clientY ?? null)
          : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchStart === null) return;
      const moved = (event.touches[0]?.clientY ?? touchStart) - touchStart;
      show(moved > 0 ? Math.min(PULL_MAX, moved * DAMPING) : 0);
    };
    const onTouchEnd = () => {
      if (touchStart !== null && distance >= PULL_THRESHOLD) refresh();
      else show(0);
      touchStart = null;
    };

    const passive = { passive: true };
    element.addEventListener('wheel', onWheel, passive);
    element.addEventListener('touchstart', onTouchStart, passive);
    element.addEventListener('touchmove', onTouchMove, passive);
    element.addEventListener('touchend', onTouchEnd, passive);
    element.addEventListener('touchcancel', onTouchEnd, passive);
    return () => {
      clearTimeout(idle);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scroller]);

  return { pull, refreshing };
}
