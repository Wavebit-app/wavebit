import { AppError } from '../../shared/errors';
import type { YtGoogleAccount, YtItem } from '../../shared/schemas/youtube';
import { arr, at, obj, readJson, str, type Json } from '../spotify/json';
import { accessToken } from './oauth';
import { ytImage } from './parse';

const API = 'https://www.googleapis.com/youtube/v3';

/** One read-only YouTube Data API call with the browser sign-in's token. */
async function get(
  route: string,
  params: Record<string, string>,
): Promise<Json> {
  const url = new URL(`${API}/${route}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      redirect: 'error',
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('network');
  }
  if (response.status === 401) throw new AppError('signed_out');
  if (response.status === 429) throw new AppError('rate_limited');
  const body = await readJson(response);
  if (!response.ok || !body) throw new AppError('network');
  return body;
}

const picture = (snippet: unknown) =>
  ytImage(
    str(at(snippet, 'thumbnails', 'high', 'url')) ??
      str(at(snippet, 'thumbnails', 'medium', 'url')) ??
      str(at(snippet, 'thumbnails', 'default', 'url')),
  );

/**
 * The account's channel, playlists, liked videos and subscriptions: four
 * reads, 50 of each (the API's page size), quota cost 4 units.
 */
export async function googleAccount(): Promise<YtGoogleAccount> {
  const [channels, playlists, liked, subscriptions] = await Promise.all([
    get('channels', { part: 'snippet', mine: 'true' }),
    get('playlists', {
      part: 'snippet,contentDetails',
      mine: 'true',
      maxResults: '50',
    }),
    get('videos', { part: 'snippet', myRating: 'like', maxResults: '50' }),
    get('subscriptions', {
      part: 'snippet',
      mine: 'true',
      maxResults: '50',
      order: 'alphabetical',
    }),
  ]);
  const me = obj(arr(channels.items)[0]);
  return {
    name: str(at(me, 'snippet', 'title')) ?? 'YouTube',
    imageUrl: picture(at(me, 'snippet')),
    playlists: arr(playlists.items).flatMap((p): YtItem[] => {
      const id = str(at(p, 'id'));
      const title = str(at(p, 'snippet', 'title'));
      if (!id || !title || !/^[A-Za-z0-9_-]{2,62}$/.test(id)) return [];
      const n = at(p, 'contentDetails', 'itemCount');
      return [
        {
          kind: 'playlist',
          title,
          subtitle: typeof n === 'number' ? `${n} videos` : 'Playlist',
          imageUrl: picture(at(p, 'snippet')),
          videoId: null,
          browseId: `VL${id}`,
        },
      ];
    }),
    liked: arr(liked.items).flatMap((v): YtItem[] => {
      const id = str(at(v, 'id'));
      const title = str(at(v, 'snippet', 'title'));
      if (!id || !title || !/^[A-Za-z0-9_-]{11}$/.test(id)) return [];
      return [
        {
          kind: 'video',
          title,
          subtitle: str(at(v, 'snippet', 'channelTitle')) ?? '',
          imageUrl: picture(at(v, 'snippet')),
          videoId: id,
          browseId: null,
        },
      ];
    }),
    subscriptions: arr(subscriptions.items).flatMap((s): YtItem[] => {
      const id = str(at(s, 'snippet', 'resourceId', 'channelId'));
      const title = str(at(s, 'snippet', 'title'));
      if (!id || !title || !/^UC[A-Za-z0-9_-]{10,40}$/.test(id)) return [];
      return [
        {
          kind: 'artist',
          title,
          subtitle: 'Channel',
          imageUrl: picture(at(s, 'snippet')),
          videoId: null,
          browseId: id,
        },
      ];
    }),
  };
}
