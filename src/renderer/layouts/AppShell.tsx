import { toast } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Settings } from '../../shared/schemas/settings';
import { refreshScope, useNav } from '../app/router';
import { setUi, useUi } from '../app/ui';
import { Events } from '../../shared/ipc/channels';
import { ContextMenuHost } from '../design/ContextMenu';
import { DetailsSheetHost } from '../design/DetailsSheet';
import { PullIndicator } from '../design/PullIndicator';
import { DownloadsSheet } from '../features/downloads/DownloadsSheet';
import { FullPlayer } from '../features/player/FullPlayer';
import { YouTubeStage } from '../features/player/YouTubeStage';
import { MiniPlayer, PlayerBar } from '../features/player/PlayerBar';
import { LyricsPanel } from '../features/lyrics/LyricsPanel';
import { NowPlayingPanel } from '../features/player/NowPlayingPanel';
import { QueuePanel } from '../features/player/QueuePanel';
import { useTrayBridge } from '../features/player/useTrayBridge';
import { useUpdateSettings, useUpdateStatus } from '../lib/queries';
import { useSizeClass } from '../lib/useBreakpoint';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { BottomNav } from './BottomNav';
import { DRAWER, SIDEBAR } from './columnLimits';
import { ResizeHandle } from './ResizeHandle';
import { useColumns } from './useColumns';
import { handleShortcut, menus, type CommandContext } from './commands';
import { ScrollContext } from './scroll';
import { ShortcutsSheet } from './ShortcutsSheet';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

const DRAWERS = {
  now: NowPlayingPanel,
  queue: QueuePanel,
  lyrics: LyricsPanel,
};

/** DESIGN.md › Layout: title bar, sidebar or rail, workspace, right panel and player bar. */
export function AppShell({
  settings,
  children,
}: {
  settings: Settings;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const update = useUpdateSettings();
  const size = useSizeClass();
  const { route } = useNav();
  const panel = useUi((s) => s.panel);
  const fullPlayer = useUi((s) => s.fullPlayer);
  const Drawer = panel ? DRAWERS[panel] : null;
  const [shortcuts, setShortcuts] = useState(false);
  useTrayBridge(() => update.mutate({ closeToTray: !settings.closeToTray }));
  const scroller = useRef<HTMLElement>(null);

  const updateReady = useUpdateStatus().data?.state === 'downloaded';
  const ctx = useMemo<CommandContext>(
    () => ({
      client,
      settings,
      update: (patch) => update.mutate(patch),
      showShortcuts: () => setShortcuts(true),
      updateReady,
    }),
    [client, settings, update, updateReady],
  );
  const menuList = useMemo(() => menus(ctx), [ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleShortcut(e, ctx);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);

  // DESIGN.md › Full-screen player: the window goes full screen with it, and
  // leaving full screen any other way closes the player.
  useEffect(() => {
    void window.wavebit.app.fullScreen(fullPlayer);
  }, [fullPlayer]);
  useEffect(
    () =>
      window.wavebit.on(Events.leftFullScreen, () =>
        setUi({ fullPlayer: false }),
      ),
    [],
  );

  // A new page starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [route]);

  // DESIGN.md › Pull to refresh: the current page asks its services again.
  const { pull, refreshing } = usePullToRefresh(
    scroller,
    async () => {
      try {
        await window.wavebit.app.refresh(refreshScope(route));
        await client.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] !== 'settings' && q.queryKey[0] !== 'app',
        });
      } catch {
        toast.danger('Couldn’t refresh this page', {
          description: 'Check your connection and try again.',
        });
      }
    },
    route.name !== 'settings',
  );

  const compact = size === 'compact';
  const rail = size === 'medium' || settings.sidebarCollapsed;
  const columns = useColumns({
    sidebar: !compact && !rail,
    drawer: !compact && !!Drawer,
  });

  return (
    <div className="flex h-full flex-col bg-canvas text-foreground">
      {!fullPlayer && <TitleBar menus={menuList} minimal={compact} connect />}
      <div className="relative flex min-h-0 flex-1">
        {!compact && <Sidebar rail={rail} />}
        {!compact && !rail && (
          <ResizeHandle
            column="sidebar"
            label="Resize the sidebar"
            value={columns.sidebar}
            min={SIDEBAR.min}
            max={columns.sidebarMax}
            grow={1}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <ScrollContext.Provider value={scroller}>
              <main
                ref={scroller}
                id="workspace"
                className={`min-w-0 flex-1 overflow-y-auto bg-surface ${compact ? 'pb-[calc(160px+env(safe-area-inset-bottom,0px)+env(keyboard-inset-height,0px))]' : 'rounded-panel'}`}
              >
                <PullIndicator pull={pull} refreshing={refreshing} />
                {children}
              </main>
            </ScrollContext.Provider>
            {Drawer && !compact && (
              <>
                <ResizeHandle
                  column="drawer"
                  label="Resize the right panel"
                  value={columns.drawer}
                  min={DRAWER.min}
                  max={columns.drawerMax}
                  grow={-1}
                />
                <Drawer />
              </>
            )}
          </div>
          {!compact && <PlayerBar />}
        </div>
        {/* No z-index: the drawer's buttons have to sit above the video stage. */}
        {compact && Drawer && (
          <div className="absolute inset-0 flex">
            <Drawer className="w-full bg-canvas pt-safe" />
          </div>
        )}
        <FullPlayer />
        <YouTubeStage />
        {compact && !Drawer && (
          <div className="pointer-events-none fixed inset-x-4 bottom-[calc(12px+env(safe-area-inset-bottom,0px)+env(keyboard-inset-height,0px))] z-30 flex flex-col gap-2">
            <MiniPlayer />
            <BottomNav />
          </div>
        )}
      </div>
      <ShortcutsSheet
        isOpen={shortcuts}
        onOpenChange={setShortcuts}
        menus={menuList}
      />
      <ContextMenuHost />
      <DetailsSheetHost />
      <DownloadsSheet />
    </div>
  );
}
