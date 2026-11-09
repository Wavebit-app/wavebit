import { Spinner } from '@heroui/react';
import { ArrowDown } from 'lucide-react';
import { PULL_THRESHOLD } from '../lib/usePullToRefresh';

/** Opens above the page as it is pulled; the arrow turns once it has gone far enough. */
export function PullIndicator({
  pull,
  refreshing,
}: {
  pull: number;
  refreshing: boolean;
}) {
  const ready = pull >= PULL_THRESHOLD;
  return (
    <div
      role="status"
      style={{ height: refreshing ? 48 : pull }}
      className={`flex items-center justify-center overflow-hidden text-muted ${pull > 0 ? '' : 'transition-[height] duration-200'}`}
    >
      {refreshing ? (
        <>
          <Spinner size="sm" color="current" />
          <span className="sr-only">Refreshing this page</span>
        </>
      ) : (
        pull > 0 && (
          <ArrowDown
            size={20}
            aria-hidden
            className={`transition-transform ${ready ? 'rotate-180' : ''}`}
          />
        )
      )}
    </div>
  );
}
