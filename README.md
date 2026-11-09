<div align="center">

<img src="assets/brand/icon.png" width="150" alt="wavebit logo">

# wavebit

### All your music in one open-source player

Your files, your Spotify library and YouTube Music, side by side.

<br>

[![Latest release](https://img.shields.io/github/v/release/Wavebit-app/wavebit?style=for-the-badge&labelColor=0d1117&color=2f5bea)](https://github.com/Wavebit-app/wavebit/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/Wavebit-app/wavebit/release.yml?style=for-the-badge&labelColor=0d1117&label=build)](https://github.com/Wavebit-app/wavebit/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/Wavebit-app/wavebit?style=for-the-badge&labelColor=0d1117&color=2f5bea)](LICENSE)

[**Download**](#download) · [**Build it yourself**](#build-it-yourself) · [**Contribute**](CONTRIBUTING.md)

<br>

<img src="assets/brand/banner.png" width="100%" alt="wavebit playing a song, under the words All your music. One player.">

</div>

- Plays your own files, with crossfade and volume levelling
- Shows your Spotify library, matched against the songs you have
- Streams YouTube Music
- Downloads songs, whole albums and playlists, with covers and lyrics
- Synced lyrics, full-screen player and artwork themes
- Updates itself and shows you what's new

## Download

| Windows                                                                    | macOS (Apple Silicon)                                                       | Linux                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Installer (.exe)](https://github.com/Wavebit-app/wavebit/releases/latest) | [Disk image (.dmg)](https://github.com/Wavebit-app/wavebit/releases/latest) | [AppImage · .deb · .rpm](https://github.com/Wavebit-app/wavebit/releases/latest) |

Builds aren't code-signed yet, so Windows and macOS will warn you the first time.

## Build it yourself

```sh
git clone https://github.com/Wavebit-app/wavebit.git && cd wavebit
npm install
npm start        # needs Node and Rust. npm run dist builds installers
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to help out.

MIT licensed. Not affiliated with Spotify or YouTube.
