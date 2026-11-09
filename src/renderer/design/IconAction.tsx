import { Button, Dropdown, Label, Spinner, Tooltip } from '@heroui/react';
import { Check, CirclePlay, Rows3, Rows4, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSettings, useUpdateSettings } from '../lib/queries';

/**
 * DESIGN.md › Page actions: an icon on its own, with no fill or frame around
 * it. It is still a real button underneath (focus ring, keyboard, a label for
 * screen readers), and the whole `size` square takes the click.
 */
export function IconAction({
  label,
  onPress,
  children,
  active = false,
  isDisabled = false,
  isPending = false,
  size = 40,
  className = '',
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  /** Filled, saved, on: the icon turns `accent`. */
  active?: boolean;
  isDisabled?: boolean;
  isPending?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={label}
          aria-pressed={active || undefined}
          isDisabled={isDisabled}
          isPending={isPending}
          onPress={onPress}
          style={{ width: size, height: size, minWidth: size }}
          className={`icon-sized icon-action ${active ? 'text-accent' : 'text-foreground'} ${className}`}
        >
          {({ isPending: busy }) =>
            busy ? <Spinner size="sm" color="current" /> : children
          }
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

/** The large Play at the head of every page that has songs. */
export function PlayAction({
  label = 'Play',
  onPress,
  isDisabled,
}: {
  label?: string;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <IconAction
      label={label}
      onPress={onPress}
      isDisabled={isDisabled}
      size={56}
    >
      <CirclePlay
        size={52}
        strokeWidth={1.5}
        className="text-accent"
        aria-hidden
      />
    </IconAction>
  );
}

/** Opens a page in the system browser, through the main process's allowlist. */
export const openInBrowser = (url: string) =>
  void window.open(url, '_blank', 'noopener');

const VIEWS: {
  id: 'comfortable' | 'compact';
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'comfortable', label: 'List', icon: Rows3 },
  { id: 'compact', label: 'Compact', icon: Rows4 },
];

/**
 * DESIGN.md › Page actions: how song rows are drawn, List or Compact. It is
 * Settings' Density under another door, so every list follows it at once.
 */
export function ViewMenu({ size = 40 }: { size?: number }) {
  const density = useSettings().data?.density ?? 'comfortable';
  const update = useUpdateSettings();
  const Current = VIEWS.find((v) => v.id === density)?.icon ?? Rows3;
  return (
    <Dropdown>
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Change how songs are shown"
        style={{ width: size, height: size, minWidth: size }}
        className="icon-sized icon-action text-foreground"
      >
        <Current size={24} aria-hidden />
      </Button>
      <Dropdown.Popover placement="bottom start" className="min-w-44">
        <Dropdown.Menu
          aria-label="Show songs as"
          onAction={(key) =>
            update.mutate({ density: key as (typeof VIEWS)[number]['id'] })
          }
        >
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <Dropdown.Item key={id} id={id} textValue={label}>
              <Icon size={16} aria-hidden />
              <Label className="flex-1">{label}</Label>
              {density === id && (
                <Check
                  size={16}
                  className="text-accent"
                  aria-label="Selected"
                />
              )}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
