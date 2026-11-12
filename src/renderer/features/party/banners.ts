import { bannerIndex } from './partyRules';

/**
 * The art behind the party's code: every image in `banners/`, cut to a wide
 * band. Add or remove files there and the drawer follows; with none, the
 * banner is a flat block. Only art wavebit may ship belongs in that folder.
 */
const files = import.meta.glob<string>('./banners/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
  query: '?url',
});
const BANNERS = Object.keys(files)
  .sort()
  .map((name) => files[name]!);

/** The banner for a party (the same for everyone in it), or the first one before a party. */
export const bannerFor = (code: string | null): string | null =>
  BANNERS[code ? bannerIndex(code, BANNERS.length) : 0] ?? null;
