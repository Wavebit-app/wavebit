import { z } from 'zod';
import { Channels } from '../../shared/ipc/channels';
import {
  YtArtistQuerySchema,
  YtCategoryQuerySchema,
  YtOAuthClientSchema,
  YtRadioSchema,
  YtSearchSchema,
  YtMatchSchema,
  YtHomeQuerySchema,
  YtOpenSchema,
  YtPageQuerySchema,
  YtSaveSchema,
} from '../../shared/schemas/youtube';
import {
  artist,
  category,
  explore,
  match,
  radio,
  search,
  home,
  library,
  open,
  page,
  save,
  status,
} from '../youtube/service';
import { googleAccount } from '../youtube/dataApi';
import {
  cancelBrowserSignIn,
  configure,
  oauthStatus,
  signInWithBrowser,
  signOutBrowser,
} from '../youtube/oauth';
import { handle } from './handle';

const NoInput = z.undefined();

export function registerYouTubeIpc(): void {
  handle(Channels.youtubeStatus, NoInput, () => status());
  handle(Channels.youtubeHome, YtHomeQuerySchema, ({ next }) => home(next));
  handle(Channels.youtubeExplore, NoInput, () => explore());
  handle(Channels.youtubeCategory, YtCategoryQuerySchema, ({ params }) =>
    category(params),
  );
  handle(Channels.youtubeOpen, YtOpenSchema, ({ videoId, browseId }) =>
    open(videoId, browseId),
  );
  handle(Channels.youtubeLibrary, NoInput, () => library());
  handle(Channels.youtubePage, YtPageQuerySchema, ({ browseId, next }) =>
    page(browseId, next),
  );
  handle(Channels.youtubeArtist, YtArtistQuerySchema, ({ browseId }) =>
    artist(browseId),
  );
  handle(Channels.youtubeMatch, YtMatchSchema, (song) => match(song));
  handle(Channels.youtubeRadio, YtRadioSchema, ({ videoId }) => radio(videoId));
  handle(Channels.youtubeSearch, YtSearchSchema, ({ query }) => search(query));
  handle(Channels.youtubeOAuthStatus, NoInput, () => oauthStatus());
  handle(
    Channels.youtubeOAuthConfigure,
    YtOAuthClientSchema,
    ({ clientId, clientSecret }) => configure(clientId, clientSecret),
  );
  handle(Channels.youtubeOAuthSignIn, NoInput, () => signInWithBrowser());
  handle(Channels.youtubeOAuthCancel, NoInput, () => cancelBrowserSignIn());
  handle(Channels.youtubeOAuthSignOut, NoInput, () => signOutBrowser());
  handle(Channels.youtubeGoogleAccount, NoInput, () => googleAccount());
  handle(Channels.youtubeSave, YtSaveSchema, ({ playlistId, saved }) =>
    save(playlistId, saved),
  );
}
