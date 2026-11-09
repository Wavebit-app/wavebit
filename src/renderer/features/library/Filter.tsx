import { Search } from 'lucide-react';
import { filterInputId } from '../../app/ui';

/** The filter pill (Ctrl F): it narrows the open list only. */
export function Filter({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="flex h-9 flex-[0_1_260px] items-center gap-2 rounded-full bg-sunken pr-3 pl-3.5 text-muted ring-1 ring-[var(--field-border)] focus-within:ring-2 focus-within:ring-accent">
      <Search size={15} aria-hidden />
      <input
        id={filterInputId}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) =>
          e.key === 'Escape' && (e.stopPropagation(), onChange(''))
        }
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
      />
    </label>
  );
}
