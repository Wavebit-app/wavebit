import { Check } from 'lucide-react';
import {
  THEME_NAMES,
  ThemeSchema,
  type Accent,
  type Theme,
} from '../../../shared/schemas/settings';
import { useSettings } from '../../lib/queries';

const ACCENTS: {
  id: Accent;
  name: string;
  light: string;
  dark: string;
  lightSoft: string;
  darkSoft: string;
}[] = [
  {
    id: 'blue',
    name: 'Blue',
    light: '#2f5bea',
    dark: '#7f95ff',
    lightSoft: '#e6ecfd',
    darkSoft: '#1f2540',
  },
  {
    id: 'violet',
    name: 'Violet',
    light: '#6148d8',
    dark: '#a28fff',
    lightSoft: '#ece8ff',
    darkSoft: '#30254b',
  },
  {
    id: 'green',
    name: 'Green',
    light: '#1f8a4c',
    dark: '#4fce87',
    lightSoft: '#e3f3ea',
    darkSoft: '#153025',
  },
  {
    id: 'amber',
    name: 'Amber',
    light: '#ba7400',
    dark: '#e7b45a',
    lightSoft: '#f7edda',
    darkSoft: '#38280f',
  },
  {
    id: 'rose',
    name: 'Rose',
    light: '#c14574',
    dark: '#ff83ad',
    lightSoft: '#f9e7ee',
    darkSoft: '#3c1d2b',
  },
];

type Painted = Exclude<Theme, 'system'>;

// DESIGN.md › Palette and Themes, as miniature app windows.
const PAINT: Record<
  Painted,
  { canvas: string; surface: string; line: string; ink: string; ink2: string }
> = {
  light: {
    canvas: '#eef0f3',
    surface: '#ffffff',
    line: '#c6ccd5',
    ink: '#14161a',
    ink2: '#8a919c',
  },
  dark: {
    canvas: '#0b0b0d',
    surface: '#131316',
    line: '#32343a',
    ink: '#f1f1f3',
    ink2: '#7e838f',
  },
  black: {
    canvas: '#000000',
    surface: '#0e0e0e',
    line: '#36363a',
    ink: '#ffffff',
    ink2: '#7e7e88',
  },
  midnight: {
    canvas: '#070b14',
    surface: '#121b30',
    line: '#34466e',
    ink: '#ffffff',
    ink2: '#7f8fa9',
  },
  artwork: {
    canvas: '#120c16',
    surface: '#1c1423',
    line: '#43364d',
    ink: '#f1f1f3',
    ink2: '#85798e',
  },
};

function SongRow({
  art,
  bar,
  width,
}: {
  art: string;
  bar: string;
  width: string;
}) {
  return (
    <span className="flex items-center gap-[5px]">
      <i
        className="size-[13px] shrink-0 rounded-[2px]"
        style={{ background: art }}
      />
      <i className="h-[3px] rounded-full" style={{ background: bar, width }} />
    </span>
  );
}

/** One theme as a small window: title bar, sidebar, song rows and player bar. */
function Preview({
  theme,
  accent,
}: {
  theme: Painted;
  accent: (typeof ACCENTS)[number];
}) {
  const c = PAINT[theme];
  const light = theme === 'light';
  const tone = light ? accent.light : accent.dark;
  const soft = light ? accent.lightSoft : accent.darkSoft;
  return (
    <span
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
      style={{ background: c.canvas }}
    >
      <span className="flex h-2.5 shrink-0 items-center px-[5px]">
        <i
          className="h-[3px] w-2 rounded-full"
          style={{ background: c.line }}
        />
        <i
          className="mx-auto h-1 w-1/3 rounded-full"
          style={{ background: c.surface }}
        />
      </span>
      <span className="flex min-h-0 flex-1">
        <span className="flex w-[26%] shrink-0 flex-col gap-1 px-1 py-[5px]">
          <i className="h-[7px] rounded-[2px]" style={{ background: soft }} />
          {['80%', '66%', '74%'].map((width) => (
            <i
              key={width}
              className="mx-0.5 mt-0.5 h-[3px] rounded-full"
              style={{ background: c.line, width }}
            />
          ))}
        </span>
        <span
          className="flex min-w-0 flex-1 flex-col rounded-tl-[3px]"
          style={{ background: c.surface }}
        >
          <span className="flex min-h-0 flex-1 flex-col gap-[5px] overflow-hidden p-2 pb-0">
            <i
              className="h-[5px] w-[46%] shrink-0 rounded-full"
              style={{ background: c.ink }}
            />
            <SongRow art={tone} bar={tone} width="62%" />
            <SongRow art={c.line} bar={c.ink2} width="48%" />
            <SongRow art={c.line} bar={c.ink2} width="56%" />
          </span>
          <span
            className="flex h-[18px] shrink-0 items-center justify-center gap-1"
            style={{ background: c.canvas }}
          >
            <i
              className="h-0.5 w-[22%] rounded-full"
              style={{ background: c.line }}
            />
            <i className="size-2 rounded-full" style={{ background: tone }} />
            <i
              className="h-0.5 w-[22%] rounded-full"
              style={{ background: c.line }}
            />
          </span>
        </span>
      </span>
    </span>
  );
}

/** DESIGN.md › Settings: the one place cards are allowed, because the picture is the point. */
export function ThemeCards({
  value,
  onChange,
  height = 124,
  themes = ThemeSchema.options,
}: {
  value: Theme;
  onChange: (t: Theme) => void;
  height?: number;
  themes?: readonly Theme[];
}) {
  const accentId = useSettings().data?.accent ?? 'blue';
  const accent = ACCENTS.find((a) => a.id === accentId)!;
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-3"
    >
      {themes.map((theme) => {
        const checked = value === theme;
        return (
          <label
            key={theme}
            className={`flex cursor-pointer flex-col gap-2.5 rounded-md bg-sunken p-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
              checked ? 'ring-2 ring-accent' : ''
            }`}
          >
            <span
              aria-hidden
              className="flex overflow-hidden rounded-[4px]"
              style={{ height }}
            >
              {theme === 'system' ? (
                <>
                  <Preview theme="light" accent={accent} />
                  <Preview theme="dark" accent={accent} />
                </>
              ) : (
                <Preview theme={theme} accent={accent} />
              )}
            </span>
            <span className="flex items-center justify-between gap-2">
              <input
                type="radio"
                name="theme"
                checked={checked}
                onChange={() => onChange(theme)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{THEME_NAMES[theme]}</span>
              {checked ? (
                <span className="flex size-[18px] items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
              ) : (
                <span className="size-[18px] rounded-full border-[1.5px] border-[var(--line-strong)]" />
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function AccentSwatches({
  value,
  onChange,
}: {
  value: Accent;
  onChange: (a: Accent) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Accent" className="flex gap-3">
      {ACCENTS.map((a) => {
        const checked = value === a.id;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={a.name}
            onClick={() => onChange(a.id)}
            className="flex size-8 items-center justify-center rounded-md text-white"
            style={{
              background: a.light,
              boxShadow: checked
                ? `0 0 0 2px var(--surface), 0 0 0 4px ${a.light}`
                : undefined,
            }}
          >
            {checked && <Check size={16} strokeWidth={2.5} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
