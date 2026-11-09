import { Kbd } from '@heroui/react';
import { SideOrBottomSheet } from '../design/Sheet';
import type { Command } from './commands';

/** The shortest a row may get on a short window; the key cap shrinks with it. */
const ROW_MIN_REM = 1.25;

export function ShortcutsSheet({
  isOpen,
  onOpenChange,
  menus,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  menus: { name: string; groups: Command[][] }[];
}) {
  return (
    <SideOrBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      fit
    >
      {/* Rows start at their full height and give way together until the list fits. */}
      <div className="flex h-full flex-col">
        {menus.map((m) => {
          const items = m.groups.flat().filter((c) => c.keys);
          if (items.length === 0) return null;
          return (
            <section
              key={m.name}
              className="flex shrink flex-col"
              style={{ minHeight: `${1.75 + items.length * ROW_MIN_REM}rem` }}
            >
              <h3 className="mb-0.5 shrink-0 text-sm font-semibold text-muted">
                {m.name}
              </h3>
              {items.map((c) => (
                <div
                  key={c.id}
                  className="flex shrink basis-[2.5rem] items-center justify-between"
                  style={{ minHeight: `${ROW_MIN_REM}rem` }}
                >
                  <span>{c.label}</span>
                  <Kbd className="h-[min(1.5rem,calc(100%-1px))] py-0">
                    {c.keys!.replace(' ', '\u00a0')}
                  </Kbd>
                </div>
              ))}
              {/* The space between groups, which gives way along with the rows. */}
              <span aria-hidden className="min-h-1 shrink basis-6" />
            </section>
          );
        })}
      </div>
    </SideOrBottomSheet>
  );
}
