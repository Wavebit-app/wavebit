import type { ReactNode } from 'react';

/**
 * The drawn art of Home's Top Picks cards, in BitChord's colours. These are
 * artwork, not theme: they stay the same in light and dark, so they live here
 * rather than in theme.css. Held still, since nothing loops (DESIGN.md › Motion).
 */

const W = 300;
const H = 400;

function Canvas({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
    >
      {children}
    </svg>
  );
}

const arrow = (tip: number) => `0,0 ${W * tip},${H / 2} 0,${H}`;

/** Outermost to innermost: where each arrow's tip rests, and its two tones. */
const PERSONAL = [
  [1, '#fe5e83', '#fa6196'],
  [0.66, '#fe5065', '#fc657c'],
  [0.43, '#fb594c', '#fc776d'],
  [0.21, '#fb6729', '#f98a48'],
] as const;

/** Nested arrows on the left edge: warm orange in the middle, out to pink. */
export function PersonalArt() {
  return (
    <Canvas>
      <defs>
        <linearGradient id="pick-personal">
          <stop stopColor="#f7334f" />
          <stop offset="0.38" stopColor="#fa6094" />
          <stop offset="0.75" stopColor="#f02a4a" />
          <stop offset="1" stopColor="#ee213d" />
        </linearGradient>
        {PERSONAL.map(([tip, deep, light], i) => (
          <linearGradient
            key={tip}
            id={`pick-personal-${i}`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={W * tip}
            y2="0"
          >
            <stop stopColor={deep} />
            <stop offset="1" stopColor={light} />
          </linearGradient>
        ))}
      </defs>
      <rect width={W} height={H} fill="url(#pick-personal)" />
      {PERSONAL.map(([tip], i) => (
        <polygon
          key={tip}
          points={arrow(tip)}
          fill={`url(#pick-personal-${i})`}
        />
      ))}
    </Canvas>
  );
}

/** Where each shard meets the edge, as a share of the width. */
const SHARD_EDGES = [0, 0.24, 0.44, 0.62, 0.78, 0.91, 1.02] as const;
const SHARDS_TOP = [
  '#3a2496',
  '#2f4fb0',
  '#3b30a0',
  '#2e7fb8',
  '#27988a',
  '#3c8da8',
];
const SHARDS_BOTTOM = [
  '#3a2496',
  '#333ea4',
  '#2f62b6',
  '#288b99',
  '#3477ba',
  '#42a296',
];

/** 10% of the way to white: the shard's colour at the fan's tip. */
const lighter = (hex: string) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.9 + 25.5)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

function Fan({
  id,
  edgeY,
  colors,
}: {
  id: string;
  edgeY: number;
  colors: string[];
}) {
  return SHARD_EDGES.slice(1).map((edge, i) => {
    const from = W * SHARD_EDGES[i]!;
    const to = W * edge;
    const base = colors[i]!;
    return (
      <g key={edge}>
        <linearGradient
          id={`${id}-${i}`}
          gradientUnits="userSpaceOnUse"
          x1={W}
          y1={H / 2}
          x2={(from + to) / 2}
          y2={edgeY}
        >
          <stop stopColor={lighter(base)} />
          <stop offset="1" stopColor={base} />
        </linearGradient>
        <polygon
          points={`${W},${H / 2} ${from},${edgeY} ${to},${edgeY}`}
          fill={`url(#${id}-${i})`}
        />
      </g>
    );
  });
}

/** A violet arrow across the card, with blue, indigo and teal shards around its tip. */
export function DiscoveryArt() {
  return (
    <Canvas>
      <defs>
        <linearGradient id="pick-discovery" x2="1" y2="1">
          <stop stopColor="#2a869f" />
          <stop offset="1" stopColor="#3477ba" />
        </linearGradient>
        <linearGradient id="pick-discovery-arrow">
          <stop stopColor="#502798" />
          <stop offset="0.55" stopColor="#421c88" />
          <stop offset="1" stopColor="#4a2292" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pick-discovery)" />
      <Fan id="pick-shard-top" edgeY={0} colors={SHARDS_TOP} />
      <Fan id="pick-shard-bottom" edgeY={H} colors={SHARDS_BOTTOM} />
      <polygon points={arrow(1)} fill="url(#pick-discovery-arrow)" />
      <polygon
        points={`0,${H * 0.1} ${W * 0.8},${H / 2} 0,${H * 0.9}`}
        fill="#3c1981"
        fillOpacity="0.35"
      />
    </Canvas>
  );
}

/** wavebit's own card: BitChord's teal, with the arrows turned to look back. */
export function RediscoverArt() {
  return (
    <Canvas>
      <defs>
        <linearGradient id="pick-rediscover" x2="0" y2="1">
          <stop stopColor="#0b6e6e" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pick-rediscover)" />
      {PERSONAL.map(([tip]) => (
        <polygon
          key={tip}
          points={`${W},0 ${W * (1 - tip)},${H / 2} ${W},${H}`}
          fill="#b5fff3"
          fillOpacity="0.1"
        />
      ))}
    </Canvas>
  );
}

/** Taller in the middle, like a passage of music rather than a test tone. */
const WAVE = [46, 88, 62, 124, 92, 168, 132, 186, 104, 150, 74, 110, 52];
const BAR = 12;
const BAR_GAP = 8;

/** wavebit's own card, for time listened: its blue, and the logo's waveform. */
export function ListeningArt() {
  return (
    <Canvas>
      <defs>
        <linearGradient id="pick-listening" x2="0.7" y2="1">
          <stop stopColor="#3f73f5" />
          <stop offset="0.55" stopColor="#2549d6" />
          <stop offset="1" stopColor="#172c94" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pick-listening)" />
      {WAVE.map((height, i) => (
        <rect
          key={i}
          x={24 + i * (BAR + BAR_GAP)}
          y={H * 0.36 - height / 2}
          width={BAR}
          height={height}
          rx={BAR / 2}
          fill="#dbe5ff"
          fillOpacity="0.2"
        />
      ))}
    </Canvas>
  );
}
