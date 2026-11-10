import { Button, Spinner } from '@heroui/react';
import { Download, RotateCw, Sparkles } from 'lucide-react';
import { nav } from '../app/router';
import { setUi } from '../app/ui';
import { WaveRing } from '../design/WaveRing';
import { useUpdateStatus } from '../lib/queries';

/** A label, not a button: no fill at rest, on hover or pressed, only the icon and the words. */
const BASE =
  'no-drag h-7 min-w-0 gap-1.5 px-1.5 text-[0.8667rem] whitespace-nowrap [--button-bg-hover:transparent] [--button-bg-pressed:transparent]';
const LABEL = `${BASE} font-medium text-foreground hover:text-accent-soft-foreground`;
/**
 * The two that need the listener, in the accent's text colour (which is ink
 * for amber in light, DESIGN.md › Contrast), still with no fill.
 */
const NEEDS_YOU = `${BASE} font-semibold text-accent-soft-foreground underline-offset-4 hover:underline`;
const ICON = 14;

const openAbout = (focus: string) => {
  nav.go({ name: 'settings', section: 'about' });
  setUi({ settingsFocus: focus });
};

/**
 * DESIGN.md › Title bar: an update on its way, ready, or just installed, as a
 * plain label (icon and words, no fill) that still takes a press. It sits first
 * among the connect labels and shows nothing the rest of the time.
 */
export function UpdateLabel() {
  const status = useUpdateStatus().data;
  if (!status) return null;
  const { state, progress = 0, justUpdated } = status;
  const updates = window.wavebit.updates;

  if (state === 'downloading')
    return (
      <Button
        variant="ghost"
        size="sm"
        className={`${LABEL} tabular-nums`}
        onPress={() => openAbout('checkUpdates')}
      >
        <span className="relative block size-[18px]" aria-hidden>
          <WaveRing value={progress / 100} live />
        </span>
        Updating {Math.round(progress)}%
      </Button>
    );

  if (state === 'downloaded')
    return (
      <Button
        variant="ghost"
        size="sm"
        className={NEEDS_YOU}
        onPress={() => void updates.install()}
      >
        <RotateCw size={ICON} strokeWidth={2.5} aria-hidden />
        Restart to update
      </Button>
    );

  if (state === 'installing')
    return (
      <div
        role="status"
        className={`${BASE} flex items-center font-medium text-muted`}
      >
        <Spinner size="sm" color="current" className="text-accent" />
        Restarting…
      </div>
    );

  if (state === 'manual')
    return (
      <Button
        variant="ghost"
        size="sm"
        className={NEEDS_YOU}
        onPress={() => void updates.open('releases')}
      >
        <Download size={ICON} strokeWidth={2.5} aria-hidden />
        Download update
      </Button>
    );

  if (justUpdated)
    return (
      <Button
        variant="ghost"
        size="sm"
        className={LABEL}
        onPress={() => {
          openAbout('whatsNew');
          void updates.markSeen();
        }}
      >
        <Sparkles size={ICON} strokeWidth={2.25} aria-hidden />
        What's new
      </Button>
    );

  return null;
}
