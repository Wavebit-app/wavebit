import { AudioWaveform } from 'lucide-react';
import { useResolvedTheme } from '../lib/useTheme';
import { useSettings } from '../lib/queries';

/** DESIGN.md › Logo: Lucide AudioWaveform, stroke only, in the fixed brand blue. */
export function Logo({
  size = 22,
  wordmark = false,
}: {
  size?: number;
  wordmark?: boolean;
}) {
  const theme = useResolvedTheme(useSettings().data);
  const brand = theme === 'dark' ? '#7f95ff' : '#2f5bea';
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.4 }}>
      <AudioWaveform
        size={size}
        color={brand}
        strokeWidth={size > 100 ? 1.5 : 2}
        role="img"
        aria-label="wavebit"
      />
      {wordmark && (
        <span
          className="font-semibold tracking-[-0.02em]"
          style={{ fontSize: size * 0.68 }}
        >
          wavebit
        </span>
      )}
    </span>
  );
}
