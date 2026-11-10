/** DESIGN.md › Layout › Resizing. How far the two side columns may go. */
export const SIDEBAR = { min: 200, initial: 232, max: 360 } as const;
export const DRAWER = { min: 300, initial: 360, max: 520 } as const;
export const RAIL = 72;
/** The page between the columns never gets narrower than this by dragging. */
export const MIN_WORKSPACE = 480;
/** The player bar's three groups fit from here; the sidebar takes room from it. */
const MIN_PLAYER_BAR = 1000;
/** The two 8px gaps between the sidebar, the page and the right panel. */
export const GUTTERS = 16;

export interface ColumnWidths {
  sidebar: number;
  drawer: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));

/** The widest the sidebar may be beside a drawer of `drawer` px. */
export function sidebarMax(window: number, drawer: number): number {
  return Math.max(
    SIDEBAR.min,
    Math.min(
      SIDEBAR.max,
      Math.max(SIDEBAR.initial, window - GUTTERS - MIN_PLAYER_BAR),
      window - GUTTERS - drawer - MIN_WORKSPACE,
    ),
  );
}

/** The widest the drawer may be beside a sidebar of `sidebar` px. */
export function drawerMax(window: number, sidebar: number): number {
  return Math.max(
    DRAWER.min,
    Math.min(DRAWER.max, window - GUTTERS - sidebar - MIN_WORKSPACE),
  );
}

/**
 * The widths to draw for this window. What the listener chose is kept as it
 * was, so a window made narrow and then wide again gets it back; meanwhile
 * the drawer gives way first, then the sidebar.
 */
export function fitColumns(
  wanted: ColumnWidths,
  window: number,
  open: { sidebar: boolean; drawer: boolean },
): ColumnWidths {
  const sidebar = open.sidebar
    ? clamp(
        wanted.sidebar,
        SIDEBAR.min,
        sidebarMax(window, open.drawer ? DRAWER.min : 0),
      )
    : RAIL;
  return {
    sidebar,
    drawer: clamp(wanted.drawer, DRAWER.min, drawerMax(window, sidebar)),
  };
}
