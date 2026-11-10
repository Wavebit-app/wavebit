import { AudioWaveform, Folder, FolderPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { SpotifyMark, YouTubeMusicMark } from '../../design/BrandMarks';
import { count } from '../../lib/format';
import screenshot from '../../assets/welcome-screenshot.webp';

/**
 * The art at the foot of each setup banner (DESIGN.md › Welcome and setup ›
 * Banner). Welcome shows the README's screenshot; the steps are drawn, and
 * each follows what the listener has already chosen, so the banner previews
 * the app they are setting up.
 */

const glass =
  'bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] backdrop-blur';

/**
 * Welcome: the README banner's own screenshot of wavebit
 * (`docs/images/wavebit.png`, resized to WebP), a window rising from the
 * foot with the banner's blue glow above it. It always reaches the foot:
 * in a tall banner the window is shown larger, cut at the right.
 */
export function WelcomeArt() {
  return (
    <img
      src={screenshot}
      alt="wavebit playing a song, with Home's Top Picks and the sidebar"
      width={1480}
      height={832}
      draggable={false}
      className="block h-full min-h-[200px] w-[92%] max-w-[1480px] rounded-t-[14px] object-cover object-left-top shadow-[0_0_0_1px_rgb(255_255_255/0.16),0_-30px_120px_color-mix(in_oklab,var(--glow)_55%,transparent)] select-none"
    />
  );
}

/** Step 1: the folders already added, then a place for the next one. */
export function FoldersArt({
  folders,
  songs,
}: {
  folders: string[];
  songs: number;
}) {
  const shown = folders.slice(0, 4);
  const row = 'flex items-center gap-4 rounded-2xl px-4 py-3.5';
  const box = 'flex size-12 shrink-0 items-center justify-center rounded-xl';
  return (
    <div className="flex w-full max-w-[520px] flex-col gap-3">
      {shown.map((folder, i) => (
        <div key={folder} className={`${row} ${glass}`}>
          <span
            className={`${box} bg-[color-mix(in_oklab,var(--glow)_45%,transparent)]`}
          >
            <Folder size={24} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-semibold">
              {folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder}
            </span>
            <span className="truncate text-[0.8667rem] text-white/60">
              {folder}
            </span>
          </span>
          {i === shown.length - 1 && (
            <span className="shrink-0 text-[0.8667rem] font-semibold text-[#8ff0b5]">
              Watching
            </span>
          )}
        </div>
      ))}
      <div className={`${row} shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]`}>
        <span
          className={`${box} bg-white/[0.06] text-white/80 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]`}
        >
          <FolderPlus size={24} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-semibold text-white/85">
            {shown.length ? 'Your next folder' : 'Your music folder'}
          </span>
          <span className="text-[0.8667rem] text-white/55">
            Add as many as you like
          </span>
        </span>
      </div>
      <p className="mt-1 text-sm text-white/70 tabular-nums">
        {songs > 0
          ? `${count(songs, 'song')} found`
          : shown.length
            ? 'Reading your files…'
            : 'No folders yet'}
      </p>
    </div>
  );
}

/**
 * Step 2: wavebit in the middle, each service lighting up once connected.
 * Drawn in a 400×300 box: the nodes are square (width and aspect ratio), so
 * they stay round, and the dashed lines run edge to edge between them.
 */
export function AccountsArt({
  spotify,
  youtube,
}: {
  spotify: boolean;
  youtube: boolean;
}) {
  const node = (lit: boolean, place: string, children: ReactNode) => (
    <span
      className={`absolute flex aspect-square w-[20%] items-center justify-center rounded-full transition-[opacity,box-shadow,background-color] duration-300 ${place} ${
        lit
          ? 'bg-white/12 shadow-[0_0_40px_rgb(255_255_255/0.18),inset_0_0_0_1px_rgb(255_255_255/0.35)]'
          : 'bg-white/[0.06] opacity-50 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
      }`}
    >
      {children}
    </span>
  );
  return (
    <div className="relative aspect-[4/3] w-full max-w-[460px]">
      <svg
        aria-hidden
        viewBox="0 0 400 300"
        className="absolute inset-0 size-full"
        fill="none"
        stroke="rgb(255 255 255 / 0.3)"
        strokeWidth={1.5}
        strokeDasharray="4 6"
      >
        <path d="M88 82 Q130 100 151 117" />
        <path d="M312 82 Q270 100 249 117" />
        <path d="M200 212 L200 218" />
      </svg>
      {node(spotify, 'top-[4%] left-[4%]', <SpotifyMark size={44} />)}
      {node(youtube, 'top-[4%] right-[4%]', <YouTubeMusicMark size={44} />)}
      {node(true, 'bottom-0 left-[40%]', <Folder size={32} aria-hidden />)}
      <span className="absolute top-[30%] left-[35%] flex aspect-square w-[30%] items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--glow)_40%,#05070d)] shadow-[0_0_60px_color-mix(in_oklab,var(--glow)_60%,transparent),inset_0_0_0_1px_rgb(255_255_255/0.2)]">
        <AudioWaveform size={60} strokeWidth={2} aria-hidden />
      </span>
    </div>
  );
}

const THEMES = [
  {
    id: 'artwork',
    name: 'Artwork',
    bg: 'linear-gradient(160deg,#3a1d5c,#7b2a6b)',
    side: 'rgb(0 0 0/.25)',
    main: 'rgb(255 255 255/.08)',
    line: 'rgb(255 255 255/.5)',
    ink: '#fff',
  },
  {
    id: 'light',
    name: 'Light',
    bg: '#eef0f3',
    side: '#e3e6ea',
    main: '#fff',
    line: '#d6dae1',
    ink: '#14161a',
  },
  {
    id: 'dark',
    name: 'Dark',
    bg: '#0b0b0d',
    side: '#131316',
    main: '#1a1b1f',
    line: '#2b2d33',
    ink: '#fff',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    bg: '#0b1226',
    side: '#0f1830',
    main: '#142041',
    line: '#22315c',
    ink: '#fff',
  },
] as const;

/** Step 3: the themes, the chosen one ringed, each with the accent's bar. */
export function ThemesArt({ theme }: { theme: string }) {
  return (
    <div className="grid w-full max-w-[520px] grid-cols-4 gap-3">
      {THEMES.map((t) => (
        <span
          key={t.id}
          className="grid aspect-[3/4] grid-cols-[24%_1fr] grid-rows-[1fr_auto] gap-1.5 rounded-xl p-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] transition-shadow"
          style={{
            background: t.bg,
            color: t.ink,
            boxShadow: theme === t.id ? '0 0 0 2px #fff' : undefined,
          }}
        >
          <span className="rounded" style={{ background: t.side }} />
          <span
            className="flex flex-col gap-1.5 rounded p-1.5"
            style={{ background: t.main }}
          >
            <i className="block h-1.5 w-3/5 rounded bg-[var(--glow)]" />
            <i className="block h-1.5 rounded" style={{ background: t.line }} />
            <i
              className="block h-1.5 w-4/5 rounded"
              style={{ background: t.line }}
            />
          </span>
          <span className="col-span-2 text-xs font-semibold">{t.name}</span>
        </span>
      ))}
    </div>
  );
}
