import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * Where YouTube's embedded player shows, after BitChord's state/video.ts:
 * surfaces (the Now playing drawer, the full-screen player's video slot and
 * its theater) take turns holding the picture, the one mounted last in front.
 * BitChord moves its one <video> element into the surface; an iframe reloads
 * when moved, so here the stage is placed over the surface and follows its box.
 *
 * With no surface mounted, the video keeps playing off screen.
 */

/** The top of the drawer: solid at the top, gone before the title. */
export const BACKDROP_MASK = 'linear-gradient(#000 42%, transparent 85%)';

interface StageState {
  surface: HTMLElement | null;
  /** The listener's choice to hide the video; it keeps playing off screen. */
  hidden: boolean;
}

const KEY = 'wavebit.videoDock';
const stack: HTMLElement[] = [];
const listeners = new Set<() => void>();

function stored(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      hidden?: unknown;
    } | null;
    return raw?.hidden === true;
  } catch {
    return false;
  }
}

let state: StageState = { surface: null, hidden: stored() };

function set(patch: Partial<StageState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  try {
    localStorage.setItem(KEY, JSON.stringify({ hidden: state.hidden }));
  } catch {
    // Storage blocked: the choice just won't be remembered.
  }
}

export const videoStage = {
  setHidden(hidden: boolean): void {
    set({ hidden });
  },
};

export function useVideoStage(): StageState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

/** Makes `ref`'s element the place the video shows while it is mounted. */
export function useVideoSurface(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    stack.push(el);
    set({ surface: el });
    return () => {
      const at = stack.indexOf(el);
      if (at >= 0) stack.splice(at, 1);
      set({ surface: stack.at(-1) ?? null });
    };
  }, [ref]);
}
