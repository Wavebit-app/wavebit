# Discord Rich Presence

Wavebit publishes Rich Presence through a compatible local Discord RPC client,
including Discord and clients such as Vesktop when RPC is available. It does
not sign in to Discord, store a Discord token, or change the account's global
online status. Presence is off by default and can be enabled in Settings ›
Discord.

On Linux and macOS, Wavebit checks the standard `discord-ipc-0` through
`discord-ipc-9` locations documented by Discord, including `XDG_RUNTIME_DIR`,
temporary directories, and `/tmp`. It also checks direct per-application
runtime directories under the current user's Flatpak runtime, which covers
clients that keep their socket in an app-specific sandbox path. The scan stays
inside those runtime directories; it does not search the filesystem or inspect
installed app packages. A client must expose Discord IPC and answer Discord's
RPC handshake. For Vesktop Flatpak, Vesktop notes that Rich Presence can be
limited by Flatpak sandboxing; native Vesktop packages are recommended when
Flatpak RPC is unavailable.

Discord application IDs are public identifiers, but each release must use a
Wavebit-owned ID. Set `WAVEBIT_DISCORD_CLIENT_ID` to that ID when starting or
building Wavebit. For example:

```sh
WAVEBIT_DISCORD_CLIENT_ID=123456789012345678 npm start
WAVEBIT_DISCORD_CLIENT_ID=123456789012345678 npm run dist
```

The Vite main-process build embeds the value in the app. Release builds read it
from the GitHub Actions repository variable `WAVEBIT_DISCORD_CLIENT_ID`. Do not
add a Discord client secret or user token. A build without an ID shows “This Wavebit build
has no Discord application configured” in Settings › Discord.

Track title, artist, optional album, playback timestamps, and eligible cover
image URLs are sent to the local Discord client when presence is enabled. Cover
images are included only when their HTTPS host is one of Spotify CDN, Google
usercontent, or YouTube image hosts. Local file paths and Wavebit's `media:`
URLs are never sent to Discord.
