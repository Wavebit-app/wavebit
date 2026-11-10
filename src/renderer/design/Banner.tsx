import { AudioWaveform } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useSettings } from '../lib/queries';
import { useMotion } from '../lib/useTheme';

/**
 * The glow's colour per accent: the accent's light tone, since the banner is
 * the same in light and dark (like PickArt) and these read on its near-black.
 */
const GLOW: Record<string, string> = {
  blue: '#2f5bea',
  violet: '#6148d8',
  green: '#1f8a4c',
  amber: '#ba7400',
  rose: '#c14574',
};

/**
 * DESIGN.md › Welcome and setup › Banner: the README banner
 * (`assets/brand/banner.html`) as the left side of welcome and setup. The
 * near-black ground, three glows (the first in the chosen accent), the giant
 * wave mark at 5%, the brand row, a headline in two tones, one line, and art
 * at the foot that previews the app. Artwork, not theme: the same in light
 * and dark. The words and art cross-fade when `id` changes.
 */
export function Banner({
  id,
  title,
  highlight,
  line,
  art,
  compact = false,
  flush = false,
  centered = false,
}: {
  id: string;
  title: string;
  highlight: string;
  line: string;
  art?: ReactNode;
  /** The strip above the column in narrow windows: words only, no art. */
  compact?: boolean;
  /** The art starts under the words and runs off the foot (Welcome's window), as in the README banner. */
  flush?: boolean;
  /** The words centred over the art, as in the README banner (Welcome). */
  centered?: boolean;
}) {
  const accent = useSettings().data?.accent ?? 'blue';
  const glow = GLOW[accent] ?? GLOW.blue;
  const motionLevel = useMotion();
  const middle = centered && !compact;
  const fade =
    motionLevel === 'off'
      ? { duration: 0 }
      : { duration: motionLevel === 'reduced' ? 0.15 : 0.3 };
  return (
    <section
      aria-label={`${title} ${highlight}`}
      style={{ ['--glow' as string]: glow }}
      className={`relative isolate flex h-full w-full flex-col overflow-hidden bg-[#05070d] text-white ${
        compact
          ? 'rounded-xl px-6 py-6'
          : 'px-[clamp(28px,4vw,56px)] pt-[clamp(32px,6vh,64px)]'
      }`}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 transition-[background] duration-300"
        style={{
          background: [
            'radial-gradient(70% 45% at 14% 10%, color-mix(in oklab, var(--glow) 78%, transparent), transparent 70%)',
            'radial-gradient(60% 40% at 92% 22%, rgb(16 170 214 / 0.42), transparent 72%)',
            'radial-gradient(110% 50% at 50% 108%, color-mix(in oklab, var(--glow) 62%, rgb(90 112 255)), transparent 72%)',
          ].join(','),
        }}
      />
      <AudioWaveform
        aria-hidden
        strokeWidth={1.1}
        className="pointer-events-none absolute -top-[14%] -left-[8%] -z-10 size-[130%] opacity-[0.05]"
      />
      <span
        className={`flex items-center gap-2.5 text-[1.0667rem] font-semibold tracking-[-0.02em] ${middle ? 'self-center' : ''}`}
      >
        <AudioWaveform size={compact ? 20 : 26} strokeWidth={2.4} aria-hidden />
        wavebit
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={id}
          initial={{ opacity: 0, y: motionLevel === 'full' ? 8 : 0 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className={`flex min-h-0 flex-1 flex-col ${middle ? 'items-center text-center' : ''}`}
        >
          <h2
            className={`font-bold tracking-[-0.04em] text-balance ${
              compact
                ? 'mt-3 text-[1.8667rem] leading-[1.08]'
                : 'mt-[clamp(14px,3vh,28px)] text-[clamp(2.2rem,3.6vw,3.6rem)] leading-[1.04]'
            }`}
          >
            {title}{' '}
            <span className="text-[color-mix(in_oklab,var(--glow)_35%,#c9d3ff)]">
              {highlight}
            </span>
          </h2>
          <p
            className={`mt-3 max-w-[36ch] text-white/75 ${middle ? 'mx-auto' : ''} ${compact ? 'text-sm' : 'text-[clamp(0.95rem,1.2vw,1.2rem)]'}`}
          >
            {line}
          </p>
          {!compact && art && (
            <div
              className={`flex min-h-0 w-full flex-1 justify-center ${flush ? 'items-start pt-[clamp(32px,7vh,72px)]' : 'items-center pt-8 pb-[clamp(28px,6vh,56px)]'}`}
            >
              {art}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
