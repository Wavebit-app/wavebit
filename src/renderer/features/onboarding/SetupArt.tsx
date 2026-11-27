import { DitherShader, type DitherPaint } from '../../design/DitherShader';
import { useSettings } from '../../lib/queries';

/**
 * DESIGN.md › Welcome and setup › Art: the wavebit mark, dithered in two
 * colours, filling the left side of every welcome and setup screen top to
 * bottom. The light colour is the chosen accent's, so step 3 recolours it
 * as you pick. Artwork, not theme: the same in light and dark.
 */

/** The mark's own path (Lucide AudioWaveform, `assets/brand/logo-mark.svg`), in a 24-unit box. */
const MARK = new Path2D(
  'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2',
);

const DARK = '#060912';
/** Each accent's light tone, bright enough to read on DARK as dots. */
const LIGHT: Record<string, string> = {
  blue: '#8ea6ff',
  violet: '#b9a8ff',
  green: '#7fe0a6',
  amber: '#ffcf70',
  rose: '#ff9fc3',
};

/** One breath of the glow, in seconds. */
const BREATH_S = 7;

/**
 * A soft glow that breathes, a large faint echo of the wave across the
 * whole side, and the mark itself, centred, with a halo the dither turns
 * into a ring of dots.
 */
const paintMark: DitherPaint = (ctx, w, h, t) => {
  const breath = (1 - Math.cos((t / BREATH_S) * Math.PI * 2)) / 2;
  const glow = ctx.createRadialGradient(
    w / 2,
    h / 2,
    0,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  const core = Math.round(40 + breath * 18);
  glow.addColorStop(0, `rgb(${core} ${core} ${core})`);
  glow.addColorStop(0.45, 'rgb(12 12 12)');
  glow.addColorStop(1, 'rgb(0 0 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const size = Math.min(w * 0.72, h * 0.46);
  const stroke = (scale: number, colour: string, blur: number) => {
    ctx.save();
    ctx.translate(w / 2 - (scale * 24) / 2, h / 2 - (scale * 24) / 2);
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = blur;
    ctx.stroke(MARK);
    ctx.restore();
  };
  // The echo: the wave again, far larger and dim, so the whole height has texture.
  stroke((Math.max(w, h) * 1.5) / 24, 'rgb(30 30 30)', 0);
  stroke(size / 24, 'rgb(255 255 255)', size * (0.14 + breath * 0.06));
  stroke(size / 24, 'rgb(255 255 255)', 0);
};

export function SetupArt({ compact = false }: { compact?: boolean }) {
  const accent = useSettings().data?.accent ?? 'blue';
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-[#060912] ${compact ? 'h-36 rounded-xl' : 'h-full w-full'}`}
    >
      <DitherShader
        paint={paintMark}
        gridSize={2}
        colorMode="duotone"
        primaryColor={DARK}
        secondaryColor={LIGHT[accent] ?? LIGHT.blue!}
        threshold={0.5}
        moving
        className="absolute inset-0 size-full"
      />
    </div>
  );
}
