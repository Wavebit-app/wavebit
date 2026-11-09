import { ToggleButton, ToggleButtonGroup } from '@heroui/react';
import type { ReactNode } from 'react';

/** A single-choice segmented control (DESIGN.md › Components). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'sm',
  fullWidth = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; ariaLabel?: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([value])}
      onSelectionChange={(keys) => {
        const [next] = [...keys];
        if (next !== undefined && next !== value) onChange(next as T);
      }}
      size={size}
      className={fullWidth ? 'w-full [&>*]:flex-1' : undefined}
    >
      {options.map((o) => (
        <ToggleButton key={o.value} id={o.value} aria-label={o.ariaLabel}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
