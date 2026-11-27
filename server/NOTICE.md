# Notice

This server is derived from the Listen Together backend of
[BitChord](https://github.com/kushagrasinghx/BitChord) (`backend/`), by
Kushagra Singh and BitChord's contributors, imported at commit
`1189e6a566c9181111205f26a983f7984f9393ea` (24 October 2026). BitChord is free
software under the GNU General Public License version 3, and so is this copy,
as part of wavebit (see `../LICENSE`).

The import is the commit `chore(server): import BitChord's party server at
1189e6a` in wavebit's history, so every change since shows as a diff against
it. In short:

- The Go module is `github.com/Wavebit-app/wavebit/server`; `main.go` became
  the `listen` package with a `Server` type and `cmd/wavebit-party`.
- Changes to how connections, limits and input are handled; README.md
  ("What's different here") lists them.
- Reactions, and a `features` list on `GET /` and `welcome`.
- The presence counter, live stats, badge and drift log were removed.
- The invite landing page opens wavebit and no longer shows the playing song.
- Deployment installs a checked binary under a hardened systemd unit, with a
  Docker image beside it; Render's blueprint was removed.
