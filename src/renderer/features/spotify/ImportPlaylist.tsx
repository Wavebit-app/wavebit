import { Button, Input, Label, TextField, toast } from '@heroui/react';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { parseSpotifyLink } from '../../../shared/spotifyLink';
import { nav } from '../../app/router';
import { SideOrBottomSheet } from '../../design/Sheet';
import { useImportPlaylist, useSignedIn } from '../../lib/queries';

/**
 * Library › Playlists: Import from a link (BitChord's Spotify import). The
 * link is read here, so only a well-formed id goes to the main process.
 */
export function ImportPlaylist() {
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const importing = useImportPlaylist();

  const change = (next: boolean) => {
    setOpen(next);
    setText('');
    setProblem(null);
  };
  const submit = () => {
    const link = parseSpotifyLink(text);
    if (link?.kind !== 'playlist') {
      setProblem('Paste a link to a Spotify playlist.');
      return;
    }
    setProblem(null);
    importing.mutate(link.id, {
      onSuccess: (playlist) => {
        change(false);
        toast(`${playlist.name} is in your playlists`);
        nav.go({ name: 'playlist', id: playlist.id });
      },
      onError: () =>
        setProblem('Spotify wouldn’t open that playlist. It may be private.'),
    });
  };

  if (!signedIn) return null;
  return (
    <>
      <Button variant="secondary" onPress={() => change(true)}>
        <Link2 size={16} aria-hidden />
        Import from a link
      </Button>
      <SideOrBottomSheet
        isOpen={open}
        onOpenChange={change}
        title="Import a playlist"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex h-full flex-col gap-4"
        >
          <p className="text-muted">
            Paste a Spotify playlist link. It joins your playlists here, and its
            songs are read from Spotify each time.
          </p>
          <TextField
            value={text}
            onChange={setText}
            autoFocus
            className="flex flex-col gap-1.5"
          >
            <Label>Playlist link</Label>
            <Input placeholder="https://open.spotify.com/playlist/…" />
          </TextField>
          {problem && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          <div className="mt-auto flex justify-end gap-2">
            <Button variant="secondary" onPress={() => change(false)}>
              Cancel
            </Button>
            <Button type="submit" isPending={importing.isPending}>
              Import
            </Button>
          </div>
        </form>
      </SideOrBottomSheet>
    </>
  );
}
