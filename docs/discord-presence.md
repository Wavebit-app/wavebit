# Discord Rich Presence

wavebit shows what you're playing on your Discord profile through the Discord
app already running on this computer (Discord, Vesktop, or another client that
offers Discord's local RPC). It never signs in to Discord, never asks for or
stores a Discord token, and never talks to Discord's servers. Presence is off
by default: Settings › Discord.

## Why not BitChord's way

BitChord gets the same card by reading the account's own token out of
discord.com and driving Discord's gateway as the user (Android WebView, the
browser extension, and its desktop app). That is against Discord's terms and
keeps a credential that can do anything to the account. Reading its code at
commit `21356206` also turned up the token written to its log on every gateway
resume, a JSON body built by pasting a URL into text, and button labels sent
unchecked (the likely cause of BitChord issue #1258). wavebit takes the local
route instead, and writes its own code: the gateway code BitChord uses carries
a no-copying notice.

The local route can't set online, idle or do-not-disturb, can't rename the
activity (Discord shows the application's registered name), and needs a
Discord app running.

## What is sent

Only while presence is on, Private listening is off and a song plays (or is
paused, with "Show paused"), one `SET_ACTIVITY` message to the local socket:

- the title (with "[1.25×]" at other speeds), the artist and album;
- start and end times in milliseconds, with the speed divided out, so Discord
  counts the bar itself; wavebit updates only on a new song, play or pause, a
  seek, a speed change or a setting change;
- a cover, only if it has a public HTTPS address on Spotify's or YouTube's
  image CDNs (256 characters at most); a file's own cover never leaves the
  computer;
- a source badge, by the name of a picture uploaded to the Discord application
  (`youtube-music`, `spotify`, `file`), never an address;
- for lossless files, the format read from the file's header in Rust, as the
  cover's hover text ("Hi-Res Lossless · FLAC · 24-bit · 96 kHz");
- up to two buttons. Their links are built in the main process from ids and can
  only be a YouTube Music song, a Spotify track or
  `https://github.com/Wavebit-app/wavebit`. Labels have `{song_name}`,
  `{artist_name}` and `{album_name}` filled in, hidden characters removed, and
  are cut to 32 characters.

A pause (with "Hide the card"), Private listening, turning presence off and
quitting send an empty activity, which takes the card down.

## How it is kept safe

`native/src/discord.rs` owns the connection on its own thread.

- **No credential.** None exists to leak. The page never sees a socket path.
- **Socket ownership.** On Linux and macOS a socket is used only if it is a
  real socket (not a link) owned by the current user. Without this, another
  account could plant `/tmp/discord-ipc-0` and read what is playing. Flatpak
  clients are found one directory deep under `XDG_RUNTIME_DIR` (`app/<id>` and
  `.flatpak/<id>/xdg-run`); nothing else is searched.
- **Checked, then rebuilt.** The activity is parsed into a fixed struct that
  refuses unknown fields; every text is 2 to 128 characters with no control,
  bidi or zero-width characters; at most two buttons of 1 to 32 characters;
  links must match one of the three shapes; times must be within 8 days of
  now. What is sent is serialised from that struct, never passed through.
- **What comes back.** Frames over 64 KB are refused. The user in Discord's
  READY is checked (id of 17 to 20 digits, picture id of 32 hex characters,
  names cleaned and cut) before a picture address is built from it; arRPC's
  stand-in user is ignored. A refused update is reported only as "rejected";
  Discord's own text is never passed on. The main process checks the report
  again with zod.
- **Rate limit.** At least a second between updates and no more than five in
  twenty seconds; the newest card wins.
- **Remaining risk on Windows.** Discord's named pipe can be opened first by
  another program running as the same user. Windows offers no simple owner
  check for that.

## Before a release

Discord application IDs are public identifiers, but each release must use a
wavebit-owned one. Set `WAVEBIT_DISCORD_CLIENT_ID` when starting or building:

```sh
WAVEBIT_DISCORD_CLIENT_ID=123456789012345678 npm start
WAVEBIT_DISCORD_CLIENT_ID=123456789012345678 npm run dist
```

Release builds read it from the GitHub Actions repository variable of the same
name. Never add a client secret or a user token. A build without an ID says so
in Settings › Discord.

In Discord's developer portal, name the application "wavebit" (Discord shows
that name after "Listening to") and give it wavebit's icon (shown when a song
has no cover). Under Rich Presence › Art Assets, upload three small pictures
named `youtube-music`, `spotify` and `file` for the source badge; until they
exist, the badge doesn't show.
