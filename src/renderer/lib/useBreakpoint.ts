import { useSyncExternalStore } from 'react';

/** DESIGN.md › Breakpoints. The only place these numbers live. */
export const BREAKPOINTS = {
  medium: 600,
  expanded: 900,
  split: 840,
  menus: 1000,
} as const;
export type SizeClass = 'compact' | 'medium' | 'expanded';

function subscribe(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}

export function useSizeClass(): SizeClass {
  const width = useWindowWidth();
  if (width < BREAKPOINTS.medium) return 'compact';
  return width < BREAKPOINTS.expanded ? 'medium' : 'expanded';
}
