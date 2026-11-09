import { Drawer, Sheet as HeroSheet } from '@heroui/react';
import type { ReactNode } from 'react';
import { useSizeClass } from '../lib/useBreakpoint';

/** A side Drawer where the queue docks on wide windows, a bottom Sheet on compact ones (DESIGN.md › Components). */
export function SideOrBottomSheet({
  isOpen,
  onOpenChange,
  title,
  fit = false,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The content sizes itself to the sheet, so no scrollbar is shown. */
  fit?: boolean;
  children: ReactNode;
}) {
  const compact = useSizeClass() === 'compact';
  const body = fit ? 'no-scrollbar' : undefined;
  if (compact)
    return (
      <HeroSheet isOpen={isOpen} onOpenChange={onOpenChange}>
        <HeroSheet.Backdrop>
          <HeroSheet.Content className="max-h-[90vh] pb-safe">
            <HeroSheet.Dialog>
              <HeroSheet.Handle />
              <HeroSheet.CloseTrigger />
              <HeroSheet.Header>
                <HeroSheet.Heading>{title}</HeroSheet.Heading>
              </HeroSheet.Header>
              <HeroSheet.Body className={body}>{children}</HeroSheet.Body>
            </HeroSheet.Dialog>
          </HeroSheet.Content>
        </HeroSheet.Backdrop>
      </HeroSheet>
    );
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop>
        {/* The queue's column: its width, from the title bar down to the player bar, or the window's edge when there's no player. */}
        <Drawer.Content
          placement="right"
          className="top-11 bottom-[var(--player-bar-h,0px)] h-auto justify-end"
        >
          <Drawer.Dialog className="h-full w-[360px] max-w-[85vw] sm:w-[360px]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{title}</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body className={body}>{children}</Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
