import { Search, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { nav } from '../../app/router';
import { filterInputId, setUi } from '../../app/ui';
import {
  SECTION_TITLES,
  searchSettings,
  type SettingEntry,
} from './settingsIndex';

/**
 * DESIGN.md › Settings: the search field, then either what it found or
 * `children`. Choosing a result opens its section, scrolls to the setting and
 * tints it for a moment.
 */
export function SettingsSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = searchSettings(query);
  const searching = query.trim() !== '';
  const active = Math.min(selected, Math.max(0, results.length - 1));

  const clear = () => {
    setQuery('');
    setSelected(0);
  };
  const open = (entry: SettingEntry) => {
    clear();
    setUi({ settingsFocus: entry.id });
    nav.go({ name: 'settings', section: entry.section });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && query) {
      // The first Esc clears the search; the next one leaves Settings.
      event.stopPropagation();
      clear();
    } else if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setSelected((active + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setSelected((active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results[active]) {
      open(results[active]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label
        className={`no-drag flex h-9 shrink-0 items-center gap-2 rounded-md pr-1 pl-2.5 text-muted ring-1 ring-[var(--field-border)] focus-within:ring-2 focus-within:ring-accent bg-sunken`}
      >
        <Search size={16} aria-hidden className="shrink-0" />
        <input
          id={filterInputId}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search settings"
          aria-label="Search settings"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-sunken"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </label>
      {searching ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          <span role="status" className="sr-only">
            {results.length === 1
              ? '1 setting found'
              : `${results.length} settings found`}
          </span>
          {results.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => open(entry)}
              onMouseEnter={() => setSelected(i)}
              className={`no-drag flex min-h-11 flex-col justify-center rounded-md px-3 py-1 text-left ${i === active ? 'bg-accent-soft text-accent-soft-foreground' : 'text-foreground'}`}
            >
              <span className="font-medium">{entry.label}</span>
              <span className="text-[0.8667rem] text-muted">
                {SECTION_TITLES[entry.section]} · {entry.group}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">
              No settings match “{query.trim()}”. Check the spelling, or try a
              word like theme, lyrics or volume.
            </p>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
