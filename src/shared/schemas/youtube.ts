import { z } from 'zod';
import type { SpotifyStorage } from './spotify';

/** What a YouTube Music card opens: a song or video plays, the rest are pages. */
export type YtKind =
  | 'song'
  | 'video'
  | 'album'
  | 'playlist'
  | 'artist'
  | 'page';

/** How a shelf is drawn (design/Shelf.tsx kinds, plus 16:9 videos). */
export type YtLayout = 'square' | 'circle' | 'tracks' | 'video';

export interface YtItem {
  kind: YtKind;
  title: string;
  /** As YouTube bills it: "Song • Artist", "Album • 2024", "1.2M views". */
  subtitle: string;
  /** A YouTube or Google image CDN URL, checked in the main process. */
  imageUrl: string | null;
  videoId: string | null;
  browseId: string | null;
}

export interface YtShelf {
  title: string;
  /** The small line above the title ("Start radio from a song"), if any. */
  strapline: string | null;
  layout: YtLayout;
  items: YtItem[];
}

export interface YtHomePage {
  shelves: YtShelf[];
  /** The continuation for more shelves, or null on the last page. */
  next: string | null;
}

export interface YtAccount {
  name: string;
  handle: string | null;
  imageUrl: string | null;
}

export type YtStatus =
  | { state: 'signed_out'; storage: SpotifyStorage }
  | { state: 'signing_in'; storage: SpotifyStorage }
  | { state: 'signed_in'; storage: SpotifyStorage; account: YtAccount | null };

/** A home continuation: YouTube's opaque paging token, never a credential. */
export const YtHomeQuerySchema = z
  .object({
    next: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_\-%=]+$/)
      .nullable(),
  })
  .strict();

/** Ids a card may open in YouTube Music: an 11-character video id or a browse id. */
export const YtOpenSchema = z
  .object({
    videoId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .nullable(),
    browseId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{2,64}$/)
      .nullable(),
  })
  .strict();

/** A song row on a YouTube Music album or playlist, matched against local files. */
export interface YtTrack {
  videoId: string;
  title: string;
  artists: string;
  album: string | null;
  durationMs: number;
  imageUrl: string | null;
  localId: string | null;
  localAlbumKey: string | null;
}

/** An album or playlist page: its header, save state and one page of rows. */
export interface YtPage {
  kind: 'album' | 'playlist';
  title: string;
  /** "Album • 2025" or "Playlist • 2026". */
  subtitle: string;
  /** The artist or owner. */
  byline: string | null;
  /** The artist's page (UC…), when the byline links to one. */
  bylineId: string | null;
  /** "14 songs • 46 minutes". */
  meta: string | null;
  description: string | null;
  imageUrl: string | null;
  /** What saving acts on, and whether it is saved; null when the page can't be saved. */
  save: { playlistId: string; saved: boolean } | null;
  items: YtTrack[];
  next: string | null;
}

/** The signed-in account's saved collections. */
export interface YtLibrary {
  playlists: YtItem[];
  albums: YtItem[];
  artists: YtItem[];
}

const BrowseId = z.string().regex(/^[A-Za-z0-9_-]{2,64}$/);
const Continuation = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_\-%=]+$/);

/** An album (MPRE…) or playlist (VL…) page, or its next page. */
export const YtPageQuerySchema = z
  .object({
    browseId: BrowseId.refine((id) => /^(MPRE|VL)/.test(id)),
    next: Continuation.nullable(),
  })
  .strict();

export const YtSaveSchema = z
  .object({ playlistId: BrowseId, saved: z.boolean() })
  .strict();

/** A YouTube Music artist page: the header and its shelves (songs, albums, singles, videos). */
export interface YtArtist {
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** "1.2M subscribers". */
  subscribers: string | null;
  shelves: YtShelf[];
}

/** A mood or genre card; `params` is all the page ever sends back for it. */
export interface YtMood {
  title: string;
  params: string;
  /** YouTube's own colour for the card, as #rrggbb. */
  color: string | null;
}

export interface YtMoodSection {
  title: string;
  items: YtMood[];
}

/** Explore: YouTube Music's feed and its moods and genres. */
export interface YtExplore {
  shelves: YtShelf[];
  moods: YtMoodSection[];
  /** When this was read from YouTube, in epoch ms. */
  fetchedAt: number;
}

export const YtCategoryParamsSchema = z
  .string()
  .regex(/^[A-Za-z0-9_\-%=]{1,128}$/);

export const YtCategoryQuerySchema = z
  .object({ params: YtCategoryParamsSchema })
  .strict();

export const YtArtistQuerySchema = z
  .object({ browseId: z.string().regex(/^UC[A-Za-z0-9_-]{10,40}$/) })
  .strict();

/** A song to find on YouTube Music: what a Spotify row knows about itself. */
export const YtMatchSchema = z
  .object({
    title: z.string().min(1).max(300),
    artists: z.array(z.string().max(200)).max(20),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
  })
  .strict();
export type YtMatchQuery = z.infer<typeof YtMatchSchema>;

/** A YouTube Music search. */
export const YtSearchSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();

/** AutoPlay's seed: one video id. */
export const YtRadioSchema = z
  .object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) })
  .strict();

/** A song of a radio, as AutoPlay appends it. */
export interface YtRadioSong {
  videoId: string;
  title: string;
  artists: string;
  durationMs: number;
  imageUrl: string | null;
  isVideo: boolean;
}

/** The YouTube Music song chosen for it. */
export interface YtMatch {
  videoId: string;
  title: string;
  artists: string;
  durationMs: number;
}

/** The Google account signed in through the browser, read with the YouTube Data API. */
export interface YtGoogleAccount {
  name: string;
  imageUrl: string | null;
  playlists: YtItem[];
  /** Liked videos: songs and videos that play through the embedded player. */
  liked: YtItem[];
  subscriptions: YtItem[];
}

export interface YtOAuthStatus {
  /** An OAuth client is set up (Settings › YouTube Music). */
  configured: boolean;
  signedIn: boolean;
  signingIn: boolean;
}

/** A Desktop-app OAuth client from Google Cloud Console. */
export const YtOAuthClientSchema = z
  .object({
    clientId: z
      .string()
      .max(200)
      .regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/),
    clientSecret: z
      .string()
      .min(10)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
