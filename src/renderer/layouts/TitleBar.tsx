import { Button, Dropdown, Kbd, Label, Tooltip } from '@heroui/react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Telescope,
} from 'lucide-react';
import { nav, useNav } from '../app/router';
import { IconAction } from '../design/IconAction';
import { Logo } from '../design/Logo';
import { SearchBox } from '../features/search/SearchBox';
import { DownloadsButton } from '../features/downloads/DownloadActions';
import { BREAKPOINTS, useWindowWidth } from '../lib/useBreakpoint';
import type { Command } from './commands';
import { ConnectLabels } from './ConnectLabels';

const mac = window.wavebit.platform === 'darwin';

function Menu({
  name,
  groups,
  icon,
}: {
  name: string;
  groups: Command[][];
  icon?: boolean;
}) {
  const all = groups.flat();
  return (
    <Dropdown>
      {icon ? (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label="Menu"
          className="no-drag size-7 min-w-7"
        >
          <Ellipsis size={16} />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="no-drag h-7 px-2.5 text-[0.8667rem] font-medium"
        >
          {name}
        </Button>
      )}
      <Dropdown.Popover placement="bottom start" className="min-w-64">
        <Dropdown.Menu
          aria-label={name}
          onAction={(key) => all.find((c) => c.id === key)?.run()}
        >
          {groups.map((group, i) => (
            <Dropdown.Section key={i} className={i > 0 ? 'pt-2' : undefined}>
              {group.map((c) => (
                <Dropdown.Item key={c.id} id={c.id} textValue={c.label}>
                  <Label className="flex-1">{c.label}</Label>
                  {c.checked && (
                    <Check
                      size={16}
                      className="text-accent"
                      aria-label="Selected"
                    />
                  )}
                  {c.keys && (
                    <Kbd slot="keyboard" className="ml-auto">
                      {c.keys.replace(' ', '\u00a0')}
                    </Kbd>
                  )}
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * DESIGN.md › Title bar: drawn by the app, a drag region with the logo, Back
 * and Forward, the menus, the search pill centred on the window, and what is
 * left to connect just before the native window controls, which sit on the
 * right (Windows, Linux) or left (macOS). A grid, so the side columns push the
 * search aside instead of running under it.
 */
export function TitleBar({
  menus,
  minimal = false,
  connect = false,
}: {
  menus?: { name: string; groups: Command[][] }[];
  minimal?: boolean;
  /** Shows the connect labels; off during welcome and setup. */
  connect?: boolean;
}) {
  const { canBack, canForward, route } = useNav();
  const width = useWindowWidth();
  const folded = width < BREAKPOINTS.menus;
  return (
    <header className="drag grid h-[48px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,442px)_minmax(max-content,1fr)] items-center bg-canvas">
      <div
        className={`flex items-center gap-1 ${mac ? 'pl-[84px]' : 'pl-3.5'}`}
      >
        <span className="mr-2.5 flex">
          <Logo size={22} />
        </span>
        {!minimal && (
          <>
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Back"
                  isDisabled={!canBack}
                  onPress={nav.back}
                  className="no-drag size-7 min-w-7"
                >
                  <ChevronLeft size={16} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Back</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Forward"
                  isDisabled={!canForward}
                  onPress={nav.forward}
                  className="no-drag size-7 min-w-7"
                >
                  <ChevronRight size={16} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Forward</Tooltip.Content>
            </Tooltip>
            {menus && !mac && (
              <nav aria-label="Menus" className="ml-2 flex gap-0.5">
                {folded ? (
                  <Menu
                    name="Menu"
                    icon
                    groups={menus.flatMap((m) => m.groups)}
                  />
                ) : (
                  menus.map((m) => <Menu key={m.name} {...m} />)
                )}
              </nav>
            )}
          </>
        )}
      </div>
      {!minimal && width >= BREAKPOINTS.medium ? (
        <div
          className="no-drag flex w-full items-center gap-1 justify-self-center"
          style={{ maxWidth: (folded ? 280 : 400) + 84 }}
        >
          <div className="min-w-0 flex-1">
            <SearchBox />
          </div>
          <IconAction
            label="Explore"
            size={38}
            active={
              route.name === 'explore' || route.name === 'exploreCategory'
            }
            onPress={() => nav.go({ name: 'explore' })}
          >
            <Telescope size={24} aria-hidden />
          </IconAction>
          <DownloadsButton />
        </div>
      ) : (
        <span />
      )}
      <div
        className={`flex items-center justify-end ${mac ? 'pr-3' : 'pr-[148px]'}`}
      >
        {!minimal && width < BREAKPOINTS.medium && <DownloadsButton />}
        {connect && <ConnectLabels />}
      </div>
    </header>
  );
}
