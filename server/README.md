# wavebit — Listen together server

The party server behind wavebit's **Listen together**: create a six-character
code, share it, and up to five devices listen to the same thing at the same
time. Go and one WebSocket per device, no database.

It began as [BitChord](https://github.com/kushagrasinghx/BitChord)'s
`backend/` (GPL-3.0; see [NOTICE.md](NOTICE.md)) and speaks the same protocol,
so BitChord's apps can join a party here and wavebit can join one on
BitChord's server. What this copy adds is listed under
[What's different here](#whats-different-here).

```bash
go run ./cmd/wavebit-party        # listens on 127.0.0.1:8000
go test -race ./...
```

---

## How devices stay in time

This is the part worth reading before changing anything. Nothing here is
synchronised by broadcasting "play now" — a frame that arrives 40 ms late on one
phone and 300 ms late on another would start them a quarter of a second apart,
and re-sending it more often would not fix that, only re-spread it.

Instead the server holds **a position and the server time that position was true
at**:

```jsonc
{
  "positionMs": 42000, // where the party was...
  "anchorMs": 1757630001234, // ...at this instant on the server's clock
  "isPlaying": true,
}
```

Each device knows its own offset from that clock, so it can answer "where should
I be _right now_" locally, whenever it likes, without another round trip:

```
serverNow   = deviceNow + clockOffset
playhead    = positionMs + max(0, serverNow - anchorMs)      // while playing
playhead    = positionMs                                      // while paused
```

A delayed frame carries an anchor that is correspondingly further in the past,
so it still lands the device in exactly the right place. That is the whole
trick, and four things protect it:

1. **The clock offset is measured, not assumed.** Each device sends
   `{"type":"ping","clientMs":…}`; the server replies with that stamp untouched
   plus its own. Offset is `serverMs - (t0 + t1) / 2`, error is bounded by half
   the round trip, and keeping the sample with the _smallest_ round trip is what
   makes this accurate over mobile data. Same idea as NTP. `GET /api/time` gives
   a client a first estimate before it has a socket.
2. **The server clock never jumps.** `clock/clock.go` reads the wall clock once
   and advances it monotonically after that, so an NTP step on the host cannot
   rewrite the anchor under a room full of phones at once.
3. **Resuming is scheduled slightly ahead.** Play and seek anchor
   `JAM_PLAY_LEAD_MS` (default 350 ms) into the future, so every device aims at
   one common instant and has time to buffer, instead of each starting whenever
   its own packet landed. Before that instant, `PositionAt` holds at the
   position rather than running backwards.
4. **The truth is re-stated on a timer.** Every `JAM_STATE_HEARTBEAT_MS`
   (default 5 s) each party is told again where it is, unprompted. Lost frames,
   a phone coming back from doze, an offset that has wandered — none of those
   announce themselves, so correctness must not depend on anyone asking.

The server's state is the truth. Devices _report_ their real playhead
(`{"type":"report"}`), but that is only logged — a party is never averaged
towards a straggler on a bad connection.

## Identity, and what it is worth

Creating or joining requires `userId`, `deviceId` and `displayName`, which the
app takes from the signed-in Google/YouTube profile. That is what puts real
names and avatars in the member list on every device.

**The server cannot verify that claim**, and is written on the assumption it
never will: it holds no Google credential, and an Innertube round trip per join
would be both slow and another way to get rate-limited. What _is_ server-held is
the **token** minted on join — unguessable, returned exactly once, and required
on every call afterwards. So a member can lie about who they are; they cannot
act as a member they are not, or join a party whose code they were not given.

If that trade ever stops being acceptable, the place to change it is
`Party.Join`: have the client send a short-lived proof from the account layer and
verify it there. Nothing above that function would need to move.

## Capacity and lifecycle

- **Five devices** (`JAM_MAX_MEMBERS`), counted per device rather than per
  account — the same person on a phone and a tablet is two streams.
- **Rejoining reclaims a slot.** Reinstall, force-stop, a socket the grace
  period outlived: all come back through the same path, so a party of five does
  not fill with ghosts of the same five devices.
- **A dropped socket is not a departure.** The membership survives
  `JAM_DISCONNECT_GRACE_MS` (default 45 s), which is what makes a tunnel or a
  screen-off invisible to everyone else.
- **The host is privileged only if it says so.** By default anyone may control
  the music and the role just decides who inherits it, passing on when the host
  leaves rather than ending the party. A host may also set `hostOnlyControl`,
  after which the server refuses every playback and queue action from anybody
  else — see the control actions below. The setting belongs to the party, so a
  new host inherits it rather than being locked out of a party they now own.
- Parties are swept when nobody has been connected for
  `JAM_EMPTY_PARTY_TTL_MS`, and unconditionally after `JAM_PARTY_MAX_AGE_MS`.

## API

All bodies and frames are camelCase — the only client is the Android app, and
matching Kotlin's naming keeps `@SerialName` off every field.

### REST

|                                   |                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                           | `{"service", "parties", "members", "serverMs", "features"}`. `features` lists what this server adds to the protocol; BitChord's sends none.                                                               |
| `GET /healthz`                    | Health check.                                                                                                                                                                                             |
| `GET /api/time`                   | `{"serverMs":…}` — a clock sample before the socket exists.                                                                                                                                               |
| `POST /api/parties`               | Create a party and join it as host. Body: `userId`, `deviceId`, `displayName`, `avatarUrl?`. → `201` with `code`, `token`, `you`, `party`. Creation is capped per IP and by the service-wide party limit. |
| `POST /api/parties/{code}/join`   | Same body. `404` unknown code, `409` full, `422` no identity. The code is normalised first, so lower case, spaces, and `O`/`I`/`L` typed for `0`/`1` all work.                                            |
| `GET /api/parties/{code}`         | Full snapshot. Needs `Authorization: Bearer <token>`.                                                                                                                                                     |
| `GET /api/parties/{code}/preview` | Who is in a party, before joining: names, pictures, how full.                                                                                                                                             |
| `POST /api/parties/{code}/leave`  | Give up the slot. Needs the bearer token. Closes that device's socket.                                                                                                                                    |

### WebSocket — `/ws/parties/{code}`

Pass the party token in `Authorization: Bearer <token>` during the WebSocket
handshake. Tokens are intentionally not accepted in the URL, which prevents
them from being recorded in common HTTP access logs.

A browser cannot set that header on a WebSocket, so the web player offers the
token as a subprotocol instead: `Sec-WebSocket-Protocol: bitchord.v1,
bitchord.token.<token>`. The server answers `bitchord.v1` and never echoes the
token. The browser's `Origin` must be in `JAM_ALLOWED_ORIGINS`.

Client → server:

```jsonc
{"type": "ping",    "clientMs": 1757630000000}
{"type": "sync"}                                   // re-send me the state
{"type": "syncQueue"}                              // my queue copy is stale
{"type": "report",  "positionMs": 42210, "isPlaying": true}
{"type": "control", "action": "play",        "positionMs": 42000}
{"type": "control", "action": "pause",       "positionMs": 42000}   // positionMs optional
{"type": "control", "action": "seek",        "positionMs": 90000}   // required
{"type": "control", "action": "setTrack",    "track": {…}, "positionMs": 0, "isPlaying": true}
{"type": "control", "action": "setQueue",    "queue": [{…}], "queueIndex": 0}
{"type": "control", "action": "queueAdd",    "tracks": [{…}], "playNext": false}
{"type": "control", "action": "queueRemove", "videoId": "…"}
{"type": "control", "action": "queueClear"}
{"type": "control", "action": "queueMove",   "fromIndex": 2, "toIndex": 5, "videoId": "…"}
{"type": "control", "action": "next"}
{"type": "control", "action": "previous"}
{"type": "control", "action": "setHostOnlyControl", "enabled": true}   // host only
{"type": "react",   "reaction": "fire"}     // wavebit addition, see Reactions
```

`setMaxMembers`, `kick` and `setHostOnlyControl` are host-only and answer
`403 host_only` to anybody else. While `hostOnlyControl` is on, so is every
action above them in that list — `play`, `pause`, `seek`, `setTrack`,
`setQueue`, `queueAdd`, `queueRemove`, `queueClear`, `queueMove`, `next`,
`previous` and `setAutoplay` — which is what makes the restriction real rather
than a matter of the app hiding its own buttons.

The flag travels on the `members` frame, alongside `maxMembers`, and in the
snapshot; it is deliberately not on the state frame, which rides the heartbeat.
Absent from either — an older server — it reads as `false`, which is the
behaviour the feature shipped with.

A `bye` frame carries a `reason`: `left` when a member gives up their own slot,
`kicked` when the host removes them. The server holds no grudge — a removed
device may rejoin immediately as far as it is concerned — but the reason lets a
client shut its own door, which is what the Android app does for 24 hours.

A `track` is `{videoId, title, artist, thumbnailUrl, durationMs, fromAutoplay}` — enough to
identify and to _show_ a song, and nothing more. Stream URLs, sources, quality
and download state stay each device's own business, so two people in a party can
be on different sources at different bitrates and still be in the same place.

Playback state also carries `startedBy` and `startedByName`, identifying the
member who selected the current track. They change only with the track;
`updatedBy` continues to identify the most recent play, pause, seek, or track
control. Keeping the name in the state preserves the attribution if that member
leaves before the song ends.

Server → client:

```jsonc
{"type": "welcome", "you": {…}, "party": {…}, "serverMs": …}
{"type": "pong",    "clientMs": …, "serverMs": …}
{"type": "state",   "playback": {…}, "serverMs": …}
{"type": "queue",   "queue": {"seq": 3, "index": 1, "items": [{…}]}, "serverMs": …}
{"type": "members", "members": [{…}], "maxMembers": 5, "serverMs": …}
{"type": "error",   "error": "rate_limited", "message": "…"}
{"type": "bye",     "reason": "left"}
{"type": "reaction", "id": 12, "memberId": "…", "reaction": "fire", "atMs": …}  // wavebit addition
```

`welcome` also carries `"features": ["reactions"]` here.

### Reactions

A wavebit addition. An app that can show reactions says so when it creates or
joins: `"features": ["reactions"]` in the body (BitChord's server ignores the
field). Any member may then send `{"type":"react","reaction":"<id>"}` with one
of the ids in [`protocol/reactions.json`](protocol/reactions.json):
`heart fire laugh wow sad clap party dance`. The ids are all that travel;
each app draws its own emoji, so a reaction can never carry text.

- The server fills in who sent it and numbers it (`id` only climbs).
- It goes to every socket that declared the feature, the sender included.
  Apps that didn't (BitChord's) never see one.
- Each member may send a burst of 5, then 3 a second; a party as a whole 15 a
  second. An unknown id or a spent allowance is dropped without an answer.
- Host-only control doesn't apply: a reaction changes nothing anyone hears.

Every mutation bumps `playback.seq`. **Clients must ignore any state whose `seq`
is not greater than the last one they applied** — that is what makes two people
hitting pause at the same moment settle instead of oscillate. A control is
broadcast to the sender too, so the controlling device re-anchors off the same
frame as everyone else rather than running on a state it predicted locally.

### The queue travels separately

**`state` does not contain the queue.** It carries `queueSeq`, `queueIndex` and
`queueLength`, and that is all. The list itself arrives:

- **whole, in a snapshot** — `welcome` and `GET /api/parties/{code}` both carry
  `party.queue`, because a device that has just arrived has no other way to
  learn it;
- **on change** — a queue control broadcasts a `queue` frame _before_ the
  `state` frame, so nobody ever holds a state pointing at an index in a list
  they have not been given;
- **on request** — a client whose `queue.seq` disagrees with the `queueSeq` in a
  state frame sends `syncQueue`. That is the self-healing half: a missed queue
  broadcast is noticed on the very next heartbeat rather than lived with.

This split is the single biggest thing keeping the service cheap. The state
frame goes to every device every few seconds forever, and the queue is the one
field in it that is both large and almost never different — a 50-track queue on
the heartbeat was roughly twenty times the bytes of everything else combined,
paid continuously, on other people's mobile data. Adding a field to `ToWire`
that grows with the queue puts all of that straight back; put it in
`QueueToWire` instead.

### Shared queue limits and delta moves

To keep memory, bandwidth, and latency strictly bounded:

- **Upcoming limit** (`JAM_MAX_UPCOMING_QUEUE`, default 25): A party holds at
  most 25 upcoming songs (excluding the active track). Additions past 25 are
  clamped or rejected with `queue_full`.
- **Delta actions**: Rather than replacing the whole array on every gesture,
  clients send lightweight deltas (`queueAdd`, `queueRemove`, `queueClear`,
  `queueMove`).
- **Race condition resilience**: `queueMove` carries an optional `videoId`
  alongside indices. If concurrent network lag (e.g. 800 ms mobile latency) or
  a track completion shifts indices, the server resolves `fromIndex` from the
  track's `videoId` under the party lock, preventing misplaced drops.
- **Repeated tracks**: the queue keeps its history, so it can hold the playing
  track twice. `setQueue` keeps the sender's `queueIndex` when it names the
  playing track, and `setTrack` without one takes the copy nearest the current
  index (the next slot first) rather than the first copy from the top.
- **AutoPlay de-duplication**: `queueAdd` drops `fromAutoplay` tracks already
  waiting after the current one (or repeated in the batch). A batch that is
  entirely such tracks succeeds without changing the queue. Hand-queued tracks
  are never filtered.

## What's different here

The protocol is BitChord's. On top of it this server adds:

- **Reactions** and a `features` list (see Reactions above).
- **One socket per member.** Leaving or being removed closes it, and every
  frame checks the sender is still in the party.
- **A queue and a writer per socket.** Sending never waits on the network; a
  device more than `JAM_SEND_QUEUE_FRAMES` frames or `JAM_SEND_QUEUE_BYTES`
  bytes behind is dropped.
- **Bounded parties.** The whole queue, played songs included, is capped at
  `JAM_MAX_QUEUE_TOTAL`, and queue edits have an allowance of their own.
- **Limits on looking up codes.** Requests without a token count against
  per-address, per-network and shared allowances for wrong codes, and every
  kind of miss gets the same answer. Members with a token are never held back
  by them.
- **Limits on making parties**, per address (an IPv6 /64) and per network (an
  IPv6 /48). A party nobody connects to ends after 30 s.
- **Forwarded client addresses only from trusted proxies**
  (`JAM_TRUSTED_PROXIES`), and loopback by default.
- **Removed devices stay out** for the rest of the party. A device id only
  takes a place back once the socket holding it has gone quiet.
- **Cleaned input.** Song ids must look like ids, names and titles lose
  direction overrides and invisible characters, and pictures must be https on
  Google, YouTube or Spotify hosts. Other members see a user id that is
  different in every party.
- **Server pings.** A socket silent for 75 s is closed.
- **The host passes to the longest-standing member**, and a party with nobody
  left ends.
- Not included: the presence counter, its stats endpoints and the drift log.

## Running your own

The server holds parties in memory, so run **one** instance. It wants a proxy
in front for HTTPS.

### A VM with Caddy (systemd)

On an Ubuntu 22.04/24.04 VM with a DNS name pointing at it (Oracle Cloud's
Always Free shapes are enough):

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o wavebit-party ./cmd/wavebit-party
sha256sum wavebit-party            # note it
scp -r wavebit-party deploy you@vm:
ssh you@vm 'sudo DOMAIN=party.example.com BINARY=./wavebit-party SHA256=<hex> bash deploy/setup.sh'
```

`setup.sh` checks the hash, installs the binary as the hardened
`wavebit-party` service (`deploy/wavebit-party.service`: no privileges, a
400 MB memory cap, loopback only), puts Caddy in front for TLS and opens 80
and 443. It compiles nothing and fetches nothing to run as root. Re-run it
with a new binary to deploy. Logs: `journalctl -u wavebit-party`.

### Docker

```sh
DOMAIN=party.example.com docker compose -f deploy/compose.yaml up -d --build
```

The image is a static binary on distroless, running as `nonroot`.
`deploy/compose.yaml` puts Caddy in front and only Caddy's network may name
the client's address.

### Behind Cloudflare

Uncomment the `trusted_proxies` lines in the Caddyfile with Cloudflare's
current ranges, and let only those ranges reach 443, or anyone can set
`CF-Connecting-IP`.

### The relay, for Host on this device

`cmd/wavebit-relay` lets a host's friends reach its computer when routers
won't let them connect directly (about 3 in 10 cases). Public libp2p relays
cut a connection after 2 minutes or 128 KiB, so wavebit runs its own. It
passes bytes both ends encrypt, holds a slot per host for an hour at a time,
at most 8 per address, and cuts a relayed connection after 30 minutes or 32
MiB (the app reconnects).

```sh
CGO_ENABLED=0 go build -trimpath -o wavebit-relay ./cmd/wavebit-relay
sudo install -m 755 wavebit-relay /opt/wavebit-party/
sudo install -m 644 deploy/wavebit-relay.service /etc/systemd/system/
sudo systemctl enable --now wavebit-relay
journalctl -u wavebit-relay | grep /p2p/   # the address to give wavebit
```

Open 4001 TCP and UDP. Its DNS name must not go through Cloudflare's proxy.
The address it prints, ending in `/p2p/<id>`, goes in Settings › Listen
together › Relay address, or into wavebit's build as its default relay.

### Pointing wavebit at it

Settings › Listen together › Party server › Custom, and type the address.
Anyone joining with your invite link is asked first, then joins there.

### Environment

Every one of these is optional — `config/config.go` carries the same defaults.

| Variable                                                                 | Default                |                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JAM_MAX_MEMBERS`                                                        | `5`                    | Devices per party.                                                                                                                                                                            |
| `JAM_STATE_HEARTBEAT_MS`                                                 | `5000`                 | How often the truth is re-stated.                                                                                                                                                             |
| `JAM_PLAY_LEAD_MS`                                                       | `350`                  | How far ahead a resume is scheduled.                                                                                                                                                          |
| `JAM_MAX_UPCOMING_QUEUE`                                                 | `25`                   | Maximum upcoming tracks in shared queue.                                                                                                                                                      |
| `JAM_MAX_QUEUE_LENGTH`                                                   | `26`                   | Hard limit on total queue length (`1 + MaxUpcomingQueue`).                                                                                                                                    |
| `JAM_DISCONNECT_GRACE_MS`                                                | `45000`                | How long a lost socket keeps its slot.                                                                                                                                                        |
| `JAM_EMPTY_PARTY_TTL_MS`                                                 | `120000`               | How long an empty party survives.                                                                                                                                                             |
| `JAM_PARTY_MAX_AGE_MS`                                                   | `43200000`             | Hard ceiling on a party's life.                                                                                                                                                               |
| `JAM_CONTROL_RATE_PER_SECOND`                                            | `25`                   | Per-member control ceiling.                                                                                                                                                                   |
| `JAM_FRAME_RATE_PER_SECOND`                                              | `30`                   | Per-member WebSocket frame ceiling, including ping and sync frames.                                                                                                                           |
| `JAM_MAX_PARTIES`                                                        | `50`                   | Maximum concurrent parties.                                                                                                                                                                   |
| `JAM_CREATE_RATE_PER_MINUTE`                                             | `2`                    | Maximum new parties per client IP per minute.                                                                                                                                                 |
| `JAM_RATE_LIMIT_MAX_ENTRIES`                                             | `10000`                | Maximum tracked client IPs before new creations are rejected, preventing the limiter itself from growing without bound.                                                                       |
| `JAM_REQUEST_MAX_BYTES`                                                  | `16384`                | Maximum REST request size.                                                                                                                                                                    |
| `JAM_WEBSOCKET_MAX_BYTES`                                                | `16384`                | Maximum incoming WebSocket message size.                                                                                                                                                      |
| `JAM_CONNECTION_IDLE_MS`                                                 | `900000`               | Close a WebSocket that sends no message for 15 minutes.                                                                                                                                       |
| `JAM_ALLOWED_ORIGINS`                                                    | _(none)_               | Comma-separated browser Origin allowlist. Native clients send no Origin and remain supported.                                                                                                 |
| `JAM_MAX_QUEUE_TOTAL`                                                    | `200`                  | Whole queue including played songs.                                                                                                                                                           |
| `JAM_MAX_PARTIES_PER_CLIENT`                                             | `3`                    | Live parties one address (IPv6 /64) may hold.                                                                                                                                                 |
| `JAM_UNCLAIMED_PARTY_TTL_MS`                                             | `30000`                | How long a party nobody connected to lives.                                                                                                                                                   |
| `JAM_LOOKUP_RATE_PER_MINUTE`                                             | `120`                  | Requests naming a code, per address.                                                                                                                                                          |
| `JAM_MISS_RATE_PER_MINUTE`                                               | `12`                   | Wrong codes or tokens per address.                                                                                                                                                            |
| `JAM_GLOBAL_MISS_RATE_PER_MINUTE`                                        | `1200`                 | Wrong codes or tokens across everyone.                                                                                                                                                        |
| `JAM_SEND_QUEUE_FRAMES`                                                  | `64`                   | Frames a device may fall behind before it is dropped.                                                                                                                                         |
| `JAM_PING_INTERVAL_MS` / `JAM_PONG_WAIT_MS`                              | `30000` / `75000`      | Server pings, and how long silence lasts before a socket is closed.                                                                                                                           |
| `JAM_MAX_BUDGET_VIOLATIONS`                                              | `20`                   | Frames over budget before a socket is closed.                                                                                                                                                 |
| `JAM_REACT_RATE_PER_SECOND` / `JAM_REACT_BURST` / `JAM_PARTY_REACT_RATE` | `3` / `5` / `15`       | Reaction allowances.                                                                                                                                                                          |
| `JAM_LISTEN_ADDR`                                                        | `127.0.0.1:$PORT`      | Where to listen. The Docker image sets `0.0.0.0:8000`.                                                                                                                                        |
| `JAM_TRUSTED_PROXIES`                                                    | `127.0.0.1/32,::1/128` | Peers whose forwarded client address is believed.                                                                                                                                             |
| `JAM_CLIENT_IP_HEADER`                                                   | _(none)_               | One header naming the client (Caddy's `X-Real-IP`), read only from a trusted proxy.                                                                                                           |
| `JAM_TRUST_PROXY`                                                        | `false`                | Without a named header, read the rightmost `X-Forwarded-For` hop, only from a trusted proxy.                                                                                                  |
| `JAM_PUBLIC_ORIGIN`                                                      | _(none)_               | Public origin emitted verbatim in invite deep links, e.g. `https://party.example.com`. Set it when TLS terminates upstream and `X-Forwarded-Proto` may be rewritten or dropped along the way. |
| `PORT`                                                                   | `8000`                 | Port the server listens on.                                                                                                                                                                   |

## Layout

```
cmd/wavebit-party/    The server binary
cmd/wavebit-p2p/      The helper wavebit ships for Host on this device
cmd/wavebit-relay/    The relay for it
p2p/                  libp2p node, the 127.0.0.1 bridge, host and joiner sides
listen/               REST routes, the socket loop, controls, frames, limits
party/party.go        Party, Member, PlaybackState: the sync rule, in-memory state
hub/hub.go            Who holds a socket; a queue and a writer per socket
clean/clean.go        Cleaning names, titles, picture addresses and song ids
clock/clock.go        The one clock, monotonic so anchors never jump
codes/codes.go        Six-character codes, and reading a mistyped one charitably
config/config.go      Environment knobs
protocol/             Action, frame and feature names; reactions.json
deploy/               systemd unit, Caddyfile, setup.sh, compose.yaml
```
