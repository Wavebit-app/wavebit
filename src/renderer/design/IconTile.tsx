import { Button, Spinner } from '@heroui/react';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * DESIGN.md › Setup steps: a large clickable icon. An 88px (or 104px) rounded
 * square on `sunken` holding the icon, its name under it and one status line.
 * The whole tile is one real button: focus ring, keyboard and a label.
 */
export function IconTile({
  label,
  icon,
  status,
  tone = 'muted',
  done = false,
  isPending = false,
  large = false,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  status?: string;
  tone?: 'muted' | 'success' | 'danger';
  /** A check in `success` on the square's corner. */
  done?: boolean;
  isPending?: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  const square = large
    ? 'size-[104px] rounded-[26px]'
    : 'size-[88px] rounded-[22px]';
  return (
    <Button
      variant="ghost"
      onPress={onPress}
      isPending={isPending}
      aria-label={status ? `${label}, ${status}` : label}
      className={`group icon-sized h-auto ${large ? 'w-[168px]' : 'w-[136px]'} flex-col items-center justify-start gap-2.5 rounded-2xl px-1 pt-1 pb-2 whitespace-normal [--button-bg-hover:transparent] [--button-bg-pressed:transparent]`}
    >
      {({ isPending: busy }) => (
        <>
          <span
            className={`relative flex ${square} items-center justify-center bg-sunken text-foreground transition-[transform,background-color] duration-150 group-hover:-translate-y-0.5 group-hover:bg-accent-soft group-data-[pressed=true]:scale-[0.97]`}
          >
            {busy ? <Spinner color="current" className="text-accent" /> : icon}
            {done && (
              <span className="absolute -right-1 -bottom-1 flex size-[26px] items-center justify-center rounded-full bg-success text-success-foreground ring-[3px] ring-surface">
                <Check size={14} strokeWidth={3} aria-hidden />
              </span>
            )}
          </span>
          <span className="text-center text-[0.9333rem] leading-tight font-semibold text-foreground">
            {label}
          </span>
          {status && (
            <span
              className={`-mt-1.5 text-center text-[0.8333rem] leading-snug ${
                tone === 'success'
                  ? 'font-medium text-success'
                  : tone === 'danger'
                    ? 'font-medium text-danger'
                    : 'text-muted'
              }`}
            >
              {status}
            </span>
          )}
        </>
      )}
    </Button>
  );
}
