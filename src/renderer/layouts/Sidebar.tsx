import { Button, Tooltip } from '@heroui/react';
import {
  ArrowLeft,
  CirclePlay,
  Download,
  House,
  Info,
  Library,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Telescope,
  type LucideIcon,
  Users,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { SpotifyMark, YouTubeMusicMark } from '../design/BrandMarks';
import { nav, useNav, type Route, type SettingsSection } from '../app/router';
import { useAppInfo, useSettings, useUpdateSettings } from '../lib/queries';
import { SettingsSearch } from '../features/settings/SettingsSearch';
import { SidebarLists } from './SidebarLists';

const MAIN: {
  label: string;
  icon: LucideIcon;
  route: Route;
  match: Route['name'][];
}[] = [
  { label: 'Home', icon: House, route: { name: 'home' }, match: ['home'] },
  {
    label: 'Explore',
    icon: Telescope,
    route: { name: 'explore' },
    match: ['explore', 'exploreCategory'],
  },
  {
    label: 'Library',
    icon: Library,
    route: { name: 'library', tab: 'overview' },
    match: [
      'library',
      'album',
      'artist',
      'spotifyAlbum',
      'spotifyArtist',
      'spotifySong',
      'ytPage',
      'ytArtist',
    ],
  },
  {
    label: 'Settings',
    icon: SettingsIcon,
    route: { name: 'settings', section: 'appearance' },
    match: ['settings'],
  },
];

/** A Lucide icon or a service's own mark: both take a size. */
type Glyph = LucideIcon | ComponentType<{ size?: number }>;

export const SETTINGS_SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: Glyph;
  group: 'General' | 'Accounts' | 'App';
}[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'General' },
  { id: 'playback', label: 'Playback', icon: CirclePlay, group: 'General' },
  { id: 'party', label: 'Listen together', icon: Users, group: 'General' },
  {
    id: 'content',
    label: 'Content preferences',
    icon: SlidersHorizontal,
    group: 'General',
  },
  { id: 'downloads', label: 'Downloads', icon: Download, group: 'General' },
  { id: 'library', label: 'Library', icon: Library, group: 'General' },
  { id: 'spotify', label: 'Spotify', icon: SpotifyMark, group: 'Accounts' },
  {
    id: 'youtube',
    label: 'YouTube Music',
    icon: YouTubeMusicMark,
    group: 'Accounts',
  },
  { id: 'about', label: 'About', icon: Info, group: 'App' },
];

function Item({
  label,
  icon: Icon,
  active,
  onPress,
  rail,
}: {
  label: string;
  icon: Glyph;
  active: boolean;
  onPress: () => void;
  rail: boolean;
}) {
  const cls = `no-drag flex h-9 items-center rounded-md font-medium transition-colors ${
    active
      ? 'bg-accent-soft font-semibold text-accent'
      : 'text-foreground hover:bg-sunken'
  }`;
  if (rail)
    return (
      <Tooltip delay={300}>
        <Tooltip.Trigger>
          <button
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={onPress}
            className={`${cls} h-10 w-12 justify-center`}
          >
            <Icon size={18} aria-hidden />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">{label}</Tooltip.Content>
      </Tooltip>
    );
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onPress}
      className={`${cls} w-full gap-3 px-3 text-left`}
    >
      <Icon size={18} aria-hidden />
      {label}
    </button>
  );
}

function Frame({ rail, children }: { rail: boolean; children: ReactNode }) {
  return (
    <nav
      aria-label="Main"
      className={`flex shrink-0 flex-col gap-0.5 overflow-hidden rounded-panel bg-surface pt-2 pb-4 ${rail ? 'mr-[8px] w-[72px] items-center px-0' : 'w-[var(--sidebar-width,232px)] px-3'}`}
    >
      {children}
    </nav>
  );
}

/** The sections in their groups, spaced apart with About at the foot. */
function SettingsNav({
  rail,
  section,
  version,
}: {
  rail: boolean;
  section: SettingsSection;
  version: string | undefined;
}) {
  const item = (s: (typeof SETTINGS_SECTIONS)[number]) => (
    <Item
      key={s.id}
      label={s.label}
      icon={s.icon}
      rail={rail}
      active={section === s.id}
      onPress={() => nav.go({ name: 'settings', section: s.id })}
    />
  );
  const group = (name: 'General' | 'Accounts') => (
    <div
      className={`flex flex-col gap-0.5 ${rail ? 'mb-4 items-center' : 'mb-4.5'}`}
    >
      {!rail && (
        <h2 className="px-3 pb-1.5 text-xs font-semibold text-muted">{name}</h2>
      )}
      {SETTINGS_SECTIONS.filter((s) => s.group === name).map(item)}
    </div>
  );
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${rail ? 'items-center' : 'mt-4.5'}`}
    >
      {group('General')}
      {group('Accounts')}
      <div
        className={`mt-auto flex flex-col gap-2 ${rail ? 'items-center' : ''}`}
      >
        {SETTINGS_SECTIONS.filter((s) => s.group === 'App').map(item)}
        {!rail && version && (
          <span className="px-3 text-sm text-muted tabular-nums">
            wavebit {version}
          </span>
        )}
      </div>
    </div>
  );
}

/** DESIGN.md › Sidebar, Rail and "Settings replaces the sidebar". */
export function Sidebar({ rail }: { rail: boolean }) {
  const { route } = useNav();
  const settings = useSettings().data;
  const update = useUpdateSettings();
  const version = useAppInfo().data?.version;

  if (route.name === 'settings')
    return (
      <Frame rail={rail}>
        {rail ? (
          <Item
            label="Back"
            icon={ArrowLeft}
            active={false}
            onPress={nav.leaveSettings}
            rail
          />
        ) : (
          <button
            type="button"
            onClick={nav.leaveSettings}
            className="no-drag mb-2.5 flex h-9 items-center gap-2.5 rounded-md px-2 text-[1rem] font-semibold hover:bg-sunken"
          >
            <ArrowLeft size={18} aria-hidden />
            Settings
            <kbd className="ml-auto rounded-[4px] bg-sunken px-1.5 py-0.5 text-xs font-medium text-muted">
              Esc
            </kbd>
          </button>
        )}
        {rail ? (
          <SettingsNav rail section={route.section} version={version} />
        ) : (
          <SettingsSearch>
            <SettingsNav
              rail={false}
              section={route.section}
              version={version}
            />
          </SettingsSearch>
        )}
      </Frame>
    );

  const collapsed = settings?.sidebarCollapsed ?? false;
  return (
    <Frame rail={rail}>
      {!rail || collapsed ? (
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={collapsed ? 'Unfold sidebar' : 'Fold sidebar'}
          onPress={() => update.mutate({ sidebarCollapsed: !collapsed })}
          className="no-drag mb-2 size-9 min-w-9 text-muted"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </Button>
      ) : null}
      {MAIN.map((m) => (
        <Item
          key={m.label}
          label={m.label}
          icon={m.icon}
          rail={rail}
          active={m.match.includes(route.name)}
          onPress={() => nav.go(m.route)}
        />
      ))}
      <SidebarLists rail={rail} />
    </Frame>
  );
}
