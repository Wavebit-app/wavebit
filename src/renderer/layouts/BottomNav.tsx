import {
  House,
  Library,
  Settings,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import { nav, useNav, type Route } from '../app/router';

const TABS: {
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
      'playlist',
      'spotifyAlbum',
      'spotifyArtist',
      'spotifySong',
      'ytPage',
      'ytArtist',
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    route: { name: 'settings', section: 'appearance' },
    match: ['settings'],
  },
];

/** DESIGN.md › Floating tab bar: a solid `raised` pill above the safe area and keyboard. */
export function BottomNav() {
  const { route } = useNav();
  return (
    <nav
      aria-label="Main"
      className="pointer-events-auto grid h-16 grid-cols-4 gap-1 rounded-full bg-overlay px-2 py-1 shadow-overlay"
    >
      {TABS.map(({ label, icon: Icon, route: target, match }) => {
        const active = match.includes(route.name);
        return (
          <button
            key={label}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => nav.go(target)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[0.7667rem] ${active ? 'font-semibold text-accent' : 'font-medium text-muted'}`}
          >
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-full ${active ? 'bg-accent-soft' : ''}`}
            >
              <Icon size={20} aria-hidden />
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
