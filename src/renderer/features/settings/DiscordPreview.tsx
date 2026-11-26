import { AudioWaveform, Music } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  DiscordActivity,
  DiscordHidden,
  DiscordState,
} from '../../../shared/schemas/discord';
import { Artwork } from '../../design/Artwork';
import { SpotifyMark, YouTubeMusicMark } from '../../design/BrandMarks';
import { Segmented } from '../../design/Segmented';
import { cachedArt } from '../../lib/format';
import { DiscordAvatar } from './DiscordAvatar';

type View = 'profile' | 'member' | 'hover';

const VERB: Record<number, string> = {
  0: 'Playing',
  2: 'Listening to',
  3: 'Watching',
  5: 'Competing in',
};

const WHY: Record<DiscordHidden, string> = {
  off: 'Presence is off. Nothing is sent to Discord.',
  private:
    'Private listening is on. Nothing is shared until you turn it off or quit wavebit.',
  nothing: 'Play something to see the preview.',
  files: 'Nothing shows while a song from your files plays.',
  paused: 'Hidden while paused.',
};

const mmss = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The badge on the cover, from the asset name the card carries. */
function Badge({ name }: { name: string }) {
  const ring =
    'absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full ring-3 ring-[color-mix(in_srgb,var(--foreground)_5%,var(--surface))]';
  if (name === 'youtube-music')
    return (
      <span className={`${ring} bg-surface`}>
        <YouTubeMusicMark size={24} />
      </span>
    );
  if (name === 'spotify')
    return (
      <span className={`${ring} bg-surface`}>
        <SpotifyMark size={24} />
      </span>
    );
  return (
    <span className={`${ring} bg-foreground text-surface`}>
      <Music size={13} strokeWidth={2.25} aria-hidden />
    </span>
  );
}

function Cover({
  card,
  size = 72,
}: {
  card: DiscordActivity | null;
  size?: number;
}) {
  const image = card?.assets?.large_image;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {image ? (
        <Artwork src={cachedArt(image)} size={size} rounded="rounded-[10px]" />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-[10px] bg-sunken text-accent"
          aria-hidden
        >
          <AudioWaveform size={size * 0.42} strokeWidth={2} />
        </span>
      )}
      {card?.assets?.small_image && <Badge name={card.assets.small_image} />}
    </span>
  );
}

/** Discord's bar, drawn from the same timestamps it is given, counting on its own. */
function Bar({ timestamps }: { timestamps: { start: number; end: number } }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const total = (timestamps.end - timestamps.start) / 1000;
  const elapsed = Math.min(total, Math.max(0, (now - timestamps.start) / 1000));
  return (
    <span className="mt-1 flex items-center gap-2 text-xs text-muted tabular-nums">
      <span>{mmss(elapsed)}</span>
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-line-strong">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: `${total > 0 ? (elapsed / total) * 100 : 0}%` }}
        />
      </span>
      <span>{mmss(total)}</span>
    </span>
  );
}

const isQuality = (text: string | undefined) =>
  !!text && /^(Hi-Res )?Lossless · /.test(text);

function Profile({ card }: { card: DiscordActivity }) {
  const paused = card.assets?.small_text === 'Paused';
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-medium text-muted">
        {VERB[card.type] ?? 'Listening to'} wavebit
      </span>
      <div className="flex items-start gap-3">
        <Cover card={card} />
        <span className="flex min-w-0 flex-1 flex-col gap-px text-sm">
          <span className="truncate font-semibold">{card.details}</span>
          {card.state && <span className="truncate">{card.state}</span>}
          {isQuality(card.assets?.large_text) && (
            <span className="truncate text-muted">
              {card.assets?.large_text}
            </span>
          )}
          {card.timestamps ? (
            <Bar timestamps={card.timestamps} />
          ) : (
            paused && <span className="text-muted">Paused</span>
          )}
        </span>
      </div>
      {card.buttons && card.buttons.length > 0 && (
        <div className="grid gap-1.5">
          {card.buttons.map((b) => (
            <span
              key={b.url}
              className="flex h-8 items-center justify-center truncate rounded-lg bg-sunken px-2.5 text-sm font-medium"
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Member({
  card,
  state,
}: {
  card: DiscordActivity;
  state: DiscordState;
}) {
  const what =
    card.status_display_type === 2
      ? card.details
      : card.status_display_type === 0
        ? 'wavebit'
        : (card.state ?? card.details);
  return (
    <div className="flex max-w-80 items-center gap-2.5 rounded-lg bg-sunken px-2.5 py-2">
      <DiscordAvatar user={state.user} size={36} dot="success" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          {state.user?.name ?? 'You'}
        </span>
        <span className="block truncate text-xs text-muted">
          {VERB[card.type] ?? 'Listening to'}{' '}
          <strong className="font-semibold text-foreground">{what}</strong>
        </span>
      </span>
    </div>
  );
}

function Bubble({ children }: { children: string }) {
  return (
    <span className="max-w-64 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-surface">
      {children}
    </span>
  );
}

function Hover({ card }: { card: DiscordActivity }) {
  const bubbles = [card.assets?.large_text, card.assets?.small_text].filter(
    (t): t is string => !!t,
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-start gap-4">
        <Cover card={card} />
        <div className="flex flex-col items-start gap-2">
          {bubbles.length ? (
            bubbles.map((b) => <Bubble key={b}>{b}</Bubble>)
          ) : (
            <span className="text-sm text-muted">
              Nothing shows on hover with these settings.
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">
        The cover’s hover text is the audio quality for lossless files,
        otherwise the album. The badge’s is where the song comes from.
      </p>
    </div>
  );
}

/** Settings › Discord › Preview: the card as it is (or would be) sent, three ways. */
export function DiscordPreview({ state }: { state: DiscordState | null }) {
  const [view, setView] = useState<View>('profile');
  const card = state?.card ?? null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <Segmented
          label="Preview view"
          value={view}
          onChange={setView}
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'member', label: 'Member list' },
            { value: 'hover', label: 'Hover' },
          ]}
        />
      </div>
      <div className="min-h-36 px-4 pt-3 pb-4" aria-live="polite">
        {!card ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <Cover card={null} />
            <span>{WHY[state?.hidden ?? 'nothing']}</span>
          </div>
        ) : view === 'member' ? (
          <Member card={card} state={state!} />
        ) : view === 'hover' ? (
          <Hover card={card} />
        ) : (
          <Profile card={card} />
        )}
      </div>
    </div>
  );
}
