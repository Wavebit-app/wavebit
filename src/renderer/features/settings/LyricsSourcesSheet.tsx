import { Button, Label, Switch } from '@heroui/react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  DEFAULT_LYRICS_ORDER,
  LYRICS_SOURCES,
  orderedSources,
  type LyricsSourceId,
} from '../../../shared/lyricsSources';
import { SideOrBottomSheet } from '../../design/Sheet';
import { useSettings, useUpdateSettings } from '../../lib/queries';

/** DESIGN.md › Settings: switch each lyric source on or off and put them in order. */
export function LyricsSourcesSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings().data!;
  const update = useUpdateSettings();
  const order = orderedSources(settings.lyricsSourceOrder);
  const off = settings.lyricsSourcesOff;

  const toggle = (id: LyricsSourceId, on: boolean) =>
    update.mutate({
      lyricsSourcesOff: on ? off.filter((x) => x !== id) : [...off, id],
    });
  const move = (at: number, by: -1 | 1) => {
    const next = [...order];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    update.mutate({ lyricsSourceOrder: next });
  };

  return (
    <SideOrBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Lyrics sources"
    >
      <p className="text-sm text-muted">
        Sources are asked together when you open lyrics, and the highest one
        here with timed lines wins. Each source you leave on receives details of
        the song, such as its title and artist.
      </p>
      <ol className="mt-3 flex flex-col gap-0.5">
        {order.map((id, i) => {
          const source = LYRICS_SOURCES.find((s) => s.id === id)!;
          return (
            <li key={id} className="flex min-h-14 items-center gap-2">
              <Switch
                isSelected={!off.includes(id)}
                onChange={(on) => toggle(id, on)}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label className="sr-only">{source.label}</Label>
                </Switch.Content>
              </Switch>
              <span className="flex min-w-0 flex-1 flex-col pl-1">
                <span className="font-medium">{source.label}</span>
                <span className="text-[0.8667rem] text-muted">
                  {source.detail}
                </span>
              </span>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label={`Move ${source.label} up`}
                isDisabled={i === 0}
                onPress={() => move(i, -1)}
                className="size-8 min-w-8"
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label={`Move ${source.label} down`}
                isDisabled={i === order.length - 1}
                onPress={() => move(i, 1)}
                className="size-8 min-w-8"
              >
                <ArrowDown size={16} />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        variant="secondary"
        className="mt-4"
        onPress={() =>
          update.mutate({
            lyricsSourceOrder: [...DEFAULT_LYRICS_ORDER],
            lyricsSourcesOff: [],
          })
        }
      >
        Restore defaults
      </Button>
    </SideOrBottomSheet>
  );
}
