import { ArrowLeft, X } from 'lucide-react';
import { setUi } from '../../app/ui';
import { IconButton } from '../player/controls';
import { VideoStrip } from '../player/VideoSlot';
import { Lyrics } from './Lyrics';

/** The drawer's words: a playing video stays at the top. */
export function LyricsPanel({
  className = 'w-[var(--drawer-width,360px)]',
}: {
  className?: string;
}) {
  return (
    <aside
      aria-label="Lyrics"
      className={`flex ${className} shrink-0 flex-col overflow-hidden bg-canvas`}
    >
      <VideoStrip />
      <div className="flex min-h-0 flex-1 flex-col pt-5 pr-4 pb-4 pl-5">
        <div className="flex items-center gap-1.5 pb-2">
          <IconButton
            label="Back to Now playing"
            onPress={() => setUi({ panel: 'now' })}
            size={32}
          >
            <ArrowLeft size={18} />
          </IconButton>
          <h2 className="flex-1 text-xl font-semibold">Lyrics</h2>
          <IconButton
            label="Close lyrics"
            onPress={() => setUi({ panel: null })}
            size={32}
          >
            <X size={18} />
          </IconButton>
        </div>
        <Lyrics size="panel" />
      </div>
    </aside>
  );
}
