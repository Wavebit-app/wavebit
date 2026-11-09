import { useEffect } from 'react';
import type { Settings } from '../../../shared/schemas/settings';
import {
  artworkSurfaces,
  vividest,
  type ArtworkSurface,
} from '../../lib/artPalette';
import { useArtColors } from '../../lib/useArtColors';
import { usePlayer } from './player';

const TOKENS: ArtworkSurface[] = [
  'canvas',
  'sunken',
  'surface',
  'default-hover',
  'raised',
  'line',
  'line-strong',
];

/** DESIGN.md › Themes: the Artwork theme tints the dark surfaces with the playing cover. */
export function useArtworkTheme(settings: Settings | undefined): void {
  const on = settings?.theme === 'artwork';
  const art = usePlayer((s) => s.queue[s.index]?.artwork);
  const colors = useArtColors(on ? art : null);
  const tint = colors ? vividest(colors) : null;
  const key = tint?.join();

  useEffect(() => {
    const root = document.documentElement;
    if (!on || !tint) {
      for (const token of TOKENS) root.style.removeProperty(`--${token}`);
      return;
    }
    const surfaces = artworkSurfaces(tint);
    for (const token of TOKENS)
      root.style.setProperty(`--${token}`, surfaces[token]);
    void window.wavebit.app.setTitleBar({
      color: surfaces.canvas,
      symbolColor: '#f1f1f3',
    });
    return () => {
      for (const token of TOKENS) root.style.removeProperty(`--${token}`);
    };
    // `key` stands for `tint`, which is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, settings]);
}
