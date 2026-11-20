import { Button, Spinner, Tooltip } from '@heroui/react';
import { WifiOff } from 'lucide-react';
import { useState } from 'react';
import { checkNow, useOffline } from '../lib/connection';
import { LABEL_BASE } from './UpdateLabel';

/**
 * DESIGN.md › Title bar: "Offline", just before Listen together, while there
 * is no internet connection, and nothing at all while there is. A press
 * checks again at once.
 */
export function OfflineLabel() {
  const offline = useOffline();
  const [checking, setChecking] = useState(false);
  if (!offline) return null;
  const check = () => {
    if (checking) return;
    setChecking(true);
    void checkNow().finally(() => setChecking(false));
  };
  return (
    <Tooltip delay={250} closeDelay={0}>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          size="sm"
          isPending={checking}
          onPress={check}
          className={`${LABEL_BASE} mr-1 font-medium text-muted hover:text-foreground`}
        >
          {checking ? (
            <Spinner size="sm" color="current" />
          ) : (
            <WifiOff size={14} strokeWidth={2.5} aria-hidden />
          )}
          <span role="status">Offline</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom end" offset={10} className="p-3">
        {/* HeroUI's tooltip breaks inside words; this is prose. */}
        <div className="flex w-60 flex-col gap-1 text-left break-normal">
          <span className="text-sm font-semibold text-foreground">
            No internet connection
          </span>
          <span className="text-xs text-muted">
            Your files, downloads and songs saved for offline still play.
            wavebit checks every few seconds and carries on when you’re back.
            Press to check now.
          </span>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}
