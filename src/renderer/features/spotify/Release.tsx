import { nav } from '../../app/router';
import { Artwork } from '../../design/Artwork';
import { menuOn } from '../../design/ContextMenu';
import { spotifyAlbumMenu } from '../menus/menus';

/** A release card: cover, name, year. Opens as a Spotify album page. */
export function Release({
  id,
  name,
  imageUrl,
  year,
}: {
  id: string;
  name: string;
  imageUrl: string | null;
  year: number | null;
}) {
  return (
    <button
      type="button"
      onClick={() => nav.go({ name: 'spotifyAlbum', id })}
      onContextMenu={menuOn(() =>
        spotifyAlbumMenu({ id, name, imageUrl, year }),
      )}
      className="flex min-w-0 flex-col gap-2 rounded-md text-left"
    >
      <Artwork
        src={imageUrl}
        className="aspect-square w-full"
        rounded="rounded-md"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        {year && (
          <span className="text-[0.8667rem] text-muted tabular-nums">
            {year}
          </span>
        )}
      </span>
    </button>
  );
}
