import { useEffect, useSyncExternalStore } from 'react';
import type { Settings } from '../../shared/schemas/settings';

const ROOT_SIZE = {
  small: '14px',
  default: '15px',
  large: '16px',
  larger: '17px',
} as const;
// DESIGN.md › Palette: `canvas` and `ink`, handed to the native window controls.
const FRAME = {
  light: { color: '#eef0f3', symbolColor: '#14161a' },
  dark: { color: '#0b0b0d', symbolColor: '#f1f1f3' },
  black: { color: '#000000', symbolColor: '#ffffff' },
  midnight: { color: '#070b14', symbolColor: '#ffffff' },
  artwork: { color: '#120c16', symbolColor: '#f1f1f3' },
};

const dark = window.matchMedia('(prefers-color-scheme: dark)');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const watch = (q: MediaQueryList) => (l: () => void) => {
  q.addEventListener('change', l);
  return () => q.removeEventListener('change', l);
};

export function useResolvedTheme(
  settings: Settings | undefined,
): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(watch(dark), () => dark.matches);
  const theme = settings?.theme ?? 'system';
  return theme === 'light' || (theme === 'system' && !systemDark)
    ? 'light'
    : 'dark';
}

/** Applies every Appearance setting to <html>, where theme.css and HeroUI read them. */
export function useApplyTheme(settings: Settings | undefined): void {
  const resolved = useResolvedTheme(settings);
  const osReduced = useSyncExternalStore(watch(reduced), () => reduced.matches);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.classList.toggle('light', resolved === 'light');
    root.dataset.theme = resolved;
    const palette =
      settings.theme === 'black' ||
      settings.theme === 'midnight' ||
      settings.theme === 'artwork'
        ? settings.theme
        : null;
    if (palette) root.dataset.palette = palette;
    else delete root.dataset.palette;
    root.dataset.blur = settings.reduceBlur ? 'off' : 'on';
    root.dataset.lyricBlur = String(
      settings.lyricsBlur && settings.syncedLyrics && !settings.reduceBlur,
    );
    if (settings.accent === 'blue') delete root.dataset.accent;
    else root.dataset.accent = settings.accent;
    if (settings.moreContrast) root.dataset.contrast = 'more';
    else delete root.dataset.contrast;
    root.dataset.density = settings.density;
    root.dataset.font = settings.font;
    root.style.setProperty('--root-size', ROOT_SIZE[settings.textSize]);
    // The OS setting caps Full at Reduced; Off also stops HeroUI's own motion.
    const motion =
      settings.motion === 'full' && osReduced ? 'reduced' : settings.motion;
    root.dataset.motion = motion;
    root.dataset.reduceMotion = String(motion === 'off');
    void window.wavebit.app.setTitleBar(FRAME[palette ?? resolved]);
  }, [settings, resolved, osReduced]);
}

export function useMotion(): 'full' | 'reduced' | 'off' {
  return (
    (document.documentElement.dataset.motion as 'full' | 'reduced' | 'off') ??
    'full'
  );
}
