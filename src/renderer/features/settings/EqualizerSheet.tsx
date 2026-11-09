import { Button, Slider } from '@heroui/react';
import { useEffect, useState } from 'react';
import { SideOrBottomSheet } from '../../design/Sheet';
import { SwitchRow } from '../../design/SwitchRow';
import { useSettings, useUpdateSettings } from '../../lib/queries';
import {
  BAND_HZ,
  BAND_LIMIT_DB,
  EQ_PRESETS,
  FLAT_BANDS,
  presetFor,
} from '../player/audioEffects';
import { player } from '../player/player';

const hertz = (hz: number) => (hz >= 1_000 ? `${hz / 1_000} kHz` : `${hz} Hz`);
const decibels = (db: number) => `${db > 0 ? '+' : ''}${db} dB`;
const first = (v: number | number[]) => (Array.isArray(v) ? v[0]! : v);

/** DESIGN.md › Settings: the equaliser's presets, seven bands and balance. */
export function EqualizerSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useSettings().data!;
  const update = useUpdateSettings();
  // Dragging is heard at once; the value is saved when the slider is let go.
  const [bands, setBands] = useState<number[]>(settings.equalizerBands);
  const [balance, setBalance] = useState(settings.equalizerBalance);
  const saved = settings.equalizerBands.join();
  useEffect(() => {
    setBands(saved.split(',').map(Number));
    setBalance(settings.equalizerBalance);
  }, [saved, settings.equalizerBalance]);

  const on = settings.equalizerEnabled;
  const active = presetFor(bands);
  const moveBand = (at: number, db: number) => {
    const next = bands.map((value, i) => (i === at ? db : value));
    setBands(next);
    player.previewEqualizer(next, balance);
  };
  const saveBands = (equalizerBands: readonly number[]) => {
    setBands([...equalizerBands]);
    update.mutate({ equalizerBands: [...equalizerBands] });
  };

  return (
    <SideOrBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Equalizer"
    >
      {/* SwitchRow reaches 12px past its parent, which would scroll this sheet sideways. */}
      <div className="px-3">
        <SwitchRow
          label="Use the equalizer"
          description="Shapes the sound of your own music files."
          isSelected={on}
          onChange={(equalizerEnabled) => update.mutate({ equalizerEnabled })}
        />
      </div>
      <h3 className="mt-4 mb-2 text-sm font-semibold">Preset</h3>
      <div className="flex flex-wrap gap-1.5">
        {EQ_PRESETS.map((preset) => {
          const selected = active?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              disabled={!on}
              onClick={() => saveBands(preset.bands)}
              className={`h-8 rounded-md px-2.5 text-sm font-medium disabled:opacity-50 ${selected ? 'bg-accent-soft text-accent-soft-foreground' : 'bg-sunken hover:bg-[var(--default-hover)]'}`}
            >
              {preset.name}
            </button>
          );
        })}
      </div>
      <h3 className="mt-5 mb-1 text-sm font-semibold">Bands</h3>
      <div className="flex flex-col">
        {BAND_HZ.map((hz, i) => (
          <div key={hz} className="flex h-9 items-center gap-3">
            <span className="w-14 shrink-0 text-[0.8667rem] text-muted tabular-nums">
              {hertz(hz)}
            </span>
            <Slider
              aria-label={`${hertz(hz)} gain`}
              minValue={-BAND_LIMIT_DB}
              maxValue={BAND_LIMIT_DB}
              step={0.5}
              value={bands[i] ?? 0}
              isDisabled={!on}
              onChange={(v) => moveBand(i, first(v))}
              onChangeEnd={(v) =>
                saveBands(bands.map((value, j) => (j === i ? first(v) : value)))
              }
              className="flex-1"
            >
              <Slider.Track className="h-1">
                <Slider.Fill />
                <Slider.Thumb className="size-3" />
              </Slider.Track>
            </Slider>
            <span className="w-14 shrink-0 text-right text-[0.8667rem] text-muted tabular-nums">
              {decibels(bands[i] ?? 0)}
            </span>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        isDisabled={!on}
        onPress={() => saveBands(FLAT_BANDS)}
      >
        Reset all bands
      </Button>
      <h3 className="mt-5 mb-1 text-sm font-semibold">Balance</h3>
      <div className="flex h-9 items-center gap-3">
        <span className="text-[0.8667rem] text-muted">L</span>
        <Slider
          aria-label="Balance"
          minValue={-1}
          maxValue={1}
          step={0.05}
          value={balance}
          onChange={(v) => {
            setBalance(first(v));
            player.previewEqualizer(bands, first(v));
          }}
          onChangeEnd={(v) => update.mutate({ equalizerBalance: first(v) })}
          className="flex-1"
        >
          <Slider.Track className="h-1">
            <Slider.Fill />
            <Slider.Thumb className="size-3" />
          </Slider.Track>
        </Slider>
        <span className="text-[0.8667rem] text-muted">R</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Shifts the sound toward one side by quietening the other.
      </p>
    </SideOrBottomSheet>
  );
}
