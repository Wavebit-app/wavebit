import { Button, Dropdown, Label } from '@heroui/react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

export interface MenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
}

export interface MenuSpec {
  /** Read out by screen readers: "Actions for Karma Police". */
  label: string;
  /** Groups, set apart by space rather than a line. */
  sections: MenuAction[][];
}

interface OpenMenu {
  spec: MenuSpec;
  x: number;
  y: number;
  /** Remounts the menu, so a second right-click moves it. */
  key: number;
  returnTo: HTMLElement | null;
}

let current: OpenMenu | null = null;
let opened = 0;
const listeners = new Set<() => void>();

function publish(next: OpenMenu | null) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openContextMenu(e: MouseEvent<HTMLElement>, spec: MenuSpec) {
  e.preventDefault();
  const box = e.currentTarget.getBoundingClientRect();
  publish({
    spec,
    // The Menu key and Shift F10 report no pointer: open at the item instead.
    x: e.clientX || box.left + 16,
    y: e.clientY || box.top + 16,
    key: ++opened,
    returnTo: e.currentTarget,
  });
}

/**
 * The handler for `onContextMenu`: a right click and the Menu key raise that
 * event, and `useLongPress` raises it for a held finger, so all open the same
 * menu. The spec is built only when asked for, since a shelf holds many items.
 */
export function menuOn(build: (() => MenuSpec | null) | undefined) {
  if (!build) return undefined;
  return (e: MouseEvent<HTMLElement>) => {
    const spec = build();
    if (spec) openContextMenu(e, spec);
  };
}

function close() {
  const returnTo = current?.returnTo;
  publish(null);
  // Back to the row or card, unless the action moved focus somewhere on purpose.
  requestAnimationFrame(() => {
    if (document.activeElement === document.body)
      returnTo?.focus({ preventScroll: true });
  });
}

/**
 * Raises `contextmenu` for a held finger or pen. Chromium doesn't do this
 * reliably on desktop platforms. Moving past a few pixels is a scroll or a
 * swipe, so it cancels; the browser's own event, if it follows, is ignored.
 */
function useLongPress() {
  useEffect(() => {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let firedAt = -Infinity;
    let swallowClick = false;

    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const down = (e: PointerEvent) => {
      swallowClick = false;
      cancel();
      if (e.pointerType === 'mouse' || !(e.target instanceof Element)) return;
      const { target, clientX, clientY } = e;
      start = { x: clientX, y: clientY };
      timer = window.setTimeout(() => {
        start = null;
        target.dispatchEvent(
          new globalThis.MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX,
            clientY,
          }),
        );
        firedAt = performance.now();
        swallowClick = true;
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (
        start &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP
      )
        cancel();
    };
    const nativeMenu = (e: Event) => {
      if (performance.now() - firedAt < 800) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const click = (e: Event) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', cancel, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('contextmenu', nativeMenu, true);
    window.addEventListener('click', click, true);
    return () => {
      cancel();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', cancel, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('contextmenu', nativeMenu, true);
      window.removeEventListener('click', click, true);
    };
  }, []);
}

/**
 * DESIGN.md › Context menus: HeroUI has no context menu, so this is its
 * Dropdown with an invisible trigger placed where the pointer was. One host
 * serves the whole app.
 */
export function ContextMenuHost() {
  const open = useSyncExternalStore(subscribe, () => current);
  useLongPress();
  if (!open) return null;
  const actions = new Map(open.spec.sections.flat().map((a) => [a.id, a]));
  return (
    <Dropdown
      key={open.key}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) close();
      }}
    >
      <Button
        aria-hidden
        excludeFromTabOrder
        style={{ position: 'fixed', left: open.x, top: open.y }}
        className="pointer-events-none size-px min-w-0 p-0 opacity-0"
      >
        <span />
      </Button>
      <Dropdown.Popover
        placement="bottom start"
        offset={2}
        className="min-w-56"
      >
        <Dropdown.Menu
          aria-label={open.spec.label}
          onAction={(key) => actions.get(String(key))?.run()}
        >
          {open.spec.sections.map((section, i) => (
            <Dropdown.Section key={i} className={i > 0 ? 'pt-2' : undefined}>
              {section.map(({ id, label, icon: Icon, danger }) => (
                <Dropdown.Item
                  key={id}
                  id={id}
                  textValue={label}
                  variant={danger ? 'danger' : undefined}
                >
                  <Icon
                    size={16}
                    aria-hidden
                    className={`shrink-0 ${danger ? 'text-danger' : 'text-muted'}`}
                  />
                  <Label>{label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
