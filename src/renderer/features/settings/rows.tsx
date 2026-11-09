import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { SwitchRow } from '../../design/SwitchRow';
import { setting } from './settingsIndex';

/**
 * BitChord's inset group: a small heading, the rows in one rounded card, and
 * an optional note under it. `bare` is for content that is already a set of
 * cards, and `anchor` is where a search result lands if there's no Row inside.
 */
export function Group({
  title,
  footer,
  anchor,
  bare = false,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  anchor?: string;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      {title && (
        <h2 className="mb-2 px-4 text-xs font-semibold tracking-wide text-muted uppercase">
          {title}
        </h2>
      )}
      <div
        data-setting={anchor && setting(anchor).id}
        className={bare ? 'rounded-md' : 'settings-group'}
      >
        {children}
      </div>
      {footer && (
        <div className="mt-2 px-4 text-sm leading-normal text-muted">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A label and hint on the left, its control on the right; the words come from the index. */
export function Row({
  id,
  hint,
  children,
}: {
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  const entry = setting(id);
  return (
    <div
      data-setting={id}
      className="flex min-h-16 flex-wrap items-center gap-4 px-4 py-1"
    >
      <span className="flex min-w-60 flex-1 flex-col gap-0.5">
        <span className="font-medium">{entry.label}</span>
        <span className="text-sm text-muted">{hint ?? entry.hint}</span>
      </span>
      {children}
    </div>
  );
}

/** A setting whose choices open in a sheet. */
export function LinkRow({
  id,
  hint,
  onPress,
}: {
  id: string;
  hint?: string;
  onPress: () => void;
}) {
  const entry = setting(id);
  return (
    <div data-setting={id}>
      <button
        type="button"
        onClick={onPress}
        className="settings-row flex min-h-16 w-full items-center gap-4 px-4 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{entry.label}</span>
          <span className="text-sm text-muted">{hint ?? entry.hint}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
      </button>
    </div>
  );
}

export function SettingSwitch({
  id,
  description,
  isSelected,
  isDisabled,
  onChange,
}: {
  id: string;
  /** Replaces the usual hint, to say why it can't be used right now. */
  description?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const entry = setting(id);
  return (
    <div data-setting={id}>
      <SwitchRow
        flush
        label={entry.label}
        description={description ?? entry.hint}
        isSelected={isSelected}
        isDisabled={isDisabled}
        onChange={onChange}
      />
    </div>
  );
}
