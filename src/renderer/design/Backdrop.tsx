import { useState } from 'react';
import { meshBackground, meshColors } from '../lib/artPalette';
import { cachedArt } from '../lib/format';
import { useSettings } from '../lib/queries';
import { useArtColors } from '../lib/useArtColors';
import { useResolvedTheme } from '../lib/useTheme';

/** Covers already drawn this session come back at once, with no fade. */
const shown = new Set<string>();

/**
 * DESIGN.md › Artwork backdrop: the cover, blurred and saturated into a wash
 * of its colours, fading away into the page. `fill` is for a whole screen
 * (the full-screen player), where text can sit anywhere, so its scrim is even.
 */
export function Backdrop({
  src,
  fill = false,
}: {
  src: string | null | undefined;
  fill?: boolean;
}) {
  const settings = useSettings().data;
  const enabled = settings?.artworkBackdrop ?? true;
  const mesh = fill && settings?.playerTheme === 'mesh';
  const colors = useArtColors(mesh && enabled ? src : null);
  const dark = useResolvedTheme(settings) === 'dark';
  const [loaded, setLoaded] = useState<string | null>(null);
  const url = src ? cachedArt(src) : null;
  if (!enabled || !url) return null;
  // DESIGN.md › Player theme: its colours keep text readable, so it needs no scrim.
  if (mesh)
    return colors ? (
      <div
        aria-hidden
        data-mesh=""
        className="art-blur pointer-events-none absolute inset-0"
        style={{ background: meshBackground(meshColors(colors, dark)) }}
      />
    ) : null;
  const ready = loaded === url || shown.has(url);
  return (
    <div
      aria-hidden
      data-backdrop={fill ? undefined : ''}
      className="art-blur pointer-events-none absolute inset-0 overflow-hidden"
    >
      <img
        key={url}
        src={url}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => {
          shown.add(url);
          setLoaded(url);
        }}
        className={`size-full scale-125 transform-gpu object-cover blur-3xl saturate-150 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
      <div className={`absolute inset-0 ${fill ? 'scrim' : 'scrim-fade'}`} />
    </div>
  );
}
