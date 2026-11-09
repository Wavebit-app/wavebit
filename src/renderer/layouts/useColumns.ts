import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useWindowWidth } from '../lib/useBreakpoint';
import {
  DRAWER,
  drawerMax,
  fitColumns,
  RAIL,
  SIDEBAR,
  sidebarMax,
  type ColumnWidths,
} from './columnLimits';

export type Column = keyof ColumnWidths;

const KEY = 'wavebit.columns';
const listeners = new Set<() => void>();
const INITIAL: ColumnWidths = {
  sidebar: SIDEBAR.initial,
  drawer: DRAWER.initial,
};

function stored(): ColumnWidths {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      sidebar?: unknown;
      drawer?: unknown;
    } | null;
    return {
      sidebar: typeof raw?.sidebar === 'number' ? raw.sidebar : INITIAL.sidebar,
      drawer: typeof raw?.drawer === 'number' ? raw.drawer : INITIAL.drawer,
    };
  } catch {
    return INITIAL;
  }
}

let wanted = stored();

const cssVar = (column: Column) => `--${column}-width`;

/** Moves the column at once, without drawing React again; for mid-drag. */
export function previewColumn(column: Column, width: number): void {
  document.documentElement.style.setProperty(cssVar(column), `${width}px`);
}

/** Keeps the listener's choice, remembered on this computer. */
export function setColumn(column: Column, width: number): void {
  wanted = { ...wanted, [column]: width };
  for (const l of listeners) l();
  try {
    localStorage.setItem(KEY, JSON.stringify(wanted));
  } catch {
    // Storage blocked: the width just won't be remembered.
  }
}

export const resetColumn = (column: Column) =>
  setColumn(column, INITIAL[column]);

/** The widths for this window, as CSS variables, and how far each may go. */
export function useColumns(open: { sidebar: boolean; drawer: boolean }) {
  const window = useWindowWidth();
  const chosen = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => wanted,
  );
  const fit = fitColumns(chosen, window, open);

  useLayoutEffect(() => {
    previewColumn('sidebar', fit.sidebar);
    previewColumn('drawer', fit.drawer);
  }, [fit.sidebar, fit.drawer]);

  return {
    ...fit,
    sidebarMax: sidebarMax(window, open.drawer ? fit.drawer : 0),
    drawerMax: drawerMax(window, open.sidebar ? fit.sidebar : RAIL),
  };
}
