import { useId, useMemo } from 'react';
import {
  RING_RADIUS,
  shownProgress,
  waveAmplitude,
  wavePath,
} from './waveRingPath';

/**
 * A wavy progress ring. The wave turns with CSS alone, under a mask that stays
 * still and draws the progress, so a running download costs no script per
 * frame. Motion set to Reduced or Off stops the turning, not the progress.
 */
export function WaveRing({
  value,
  live = false,
  waves = 10,
  label,
  className = 'absolute inset-0 text-accent',
}: {
  /** 0 to 1. */
  value: number;
  /** Downloading now: the wave turns. Waiting rings stay still. */
  live?: boolean;
  waves?: number;
  /** Set where the ring is the only thing saying what's happening. */
  label?: string;
  className?: string;
}) {
  const mask = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const amplitude = waveAmplitude(value);
  const d = useMemo(() => wavePath(waves, amplitude), [waves, amplitude]);
  const shown = shownProgress(value, live) * 100;
  return (
    <span
      {...(label
        ? {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(value * 100),
          }
        : { 'aria-hidden': true })}
      className={`pointer-events-none block ${className}`}
    >
      {/* Sized here: .icon-sized would otherwise shrink an svg with no width. */}
      <svg
        viewBox="0 0 100 100"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <mask
            id={mask}
            maskUnits="userSpaceOnUse"
            x="-5"
            y="-5"
            width="110"
            height="110"
          >
            <circle
              className="wave-ring-arc"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              fill="none"
              stroke="#fff"
              strokeWidth="24"
              pathLength="100"
              strokeDasharray={`${shown} 100`}
              transform="rotate(-90 50 50)"
            />
          </mask>
        </defs>
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="4"
        />
        <g mask={`url(#${mask})`}>
          <path
            className={live ? 'wave-ring-turn' : undefined}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="6.5"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  );
}
