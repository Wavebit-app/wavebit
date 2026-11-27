# Host on this device

Listen together normally runs on a party server: wavebit's, BitChord's or
one you run. With **Host on this device** (Settings › Listen together › This
device), a party runs on the host's own computer instead, and friends connect
to it.

## How it connects

```
 friend's wavebit                                       host's wavebit
 party client ──► bridge 127.0.0.1 ─┐            ┌─► bridge 127.0.0.1 ◄── party client
                  wavebit-p2p       │  libp2p    │   wavebit-p2p
                                    └─► relay ◄──┘   (runs the party server)
                                    └──── direct ────┘  when routers allow
```

- The app never speaks libp2p. Each computer runs the helper
  `tools/wavebit-p2p` (built from `server/cmd/wavebit-p2p`). The app's
  ordinary party client connects to the helper's bridge on `127.0.0.1` as if
  it were a server.
- On the host, the helper runs the same party server as `server/listen`,
  limited to one party of up to ten devices.
- A friend's helper reaches the host through wavebit's relay
  (`server/cmd/wavebit-relay`), then tries to open a direct connection
  (libp2p's DCUtR hole punching, about 7 in 10 cases succeed). When it can't,
  the party stays on the relay. Both paths are encrypted end to end (Noise or
  TLS 1.3); the relay passes bytes it can't read.
- There is no DHT, no bootstrap list, no local discovery and no public IPFS
  network. The invite link names the host's identity directly, so there is
  nothing to look up and no code to guess.

## Without a relay

A relay is optional. With none set (and _Allow direct connections_ on), the
host's helper asks the router to forward a port to it (UPnP or NAT-PMP,
removed when the party ends) and the invite lists the addresses the
computer can be reached at (`at=`): the port the router opened, a public
IPv6 address, and the home network's own. A friend's helper dials those
straight, checking the host's identity as always.

- Friends on the same network can always join.
- Friends elsewhere can join when the router opened the port. When it
  didn't, the host's drawer says that only people on the same network can
  join, and how to change that (UPnP on the router, or a relay).
- With direct connections off and no relay, there is no way in, and hosting
  says so.

## Getting a direct connection

Three things make the direct path happen with only one relay in the picture:

1. **Trusting one observer.** libp2p only believes a computer's outside
   address after 4 different peers report it, which suits the public IPFS
   network. A party computer talks to one relay and a few friends, so it would
   never believe one and would never hole punch. The helper believes one
   report (`server/p2p/node.go`). A wrong report only costs a failed attempt.
2. **Being ready before the host punches.** The host starts hole punching the
   moment a friend connects through the relay, and only once. The friend's
   side only answers after it knows its own outside address. So the friend's
   helper waits for that before connecting. If no direct connection appears
   within 3 seconds, it connects once more, which gives the host a second try.
   All of this happens before the party's traffic starts.
3. **Same network or same machine.** Hole punching only uses public
   addresses, so the friend also dials the addresses the host announced
   itself. Each address is checked against the host's identity like any other.

Once a direct connection exists, both helpers close the relayed one. The
party's socket closes with it and the app reconnects within a second,
directly, which keeps the relay free for parties that need it.

Tested on one Linux machine with network namespaces: two homes, each behind
its own NAT router that firewalls unsolicited traffic, and the relay on a
pretend internet.

| Routers                            | Result                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Ordinary NAT (keeps ports)         | Direct in about 4 s, 5 runs out of 5; the relay path was then dropped |
| Strict NAT (random ports)          | Stays on the relay; the party works                                   |
| Direct connections off on one side | Stays on the relay                                                    |

On macOS, dialing a host's local addresses may make the system ask once
whether wavebit may find devices on the local network.

## The invite

```
wavebit://party/K7M2QX?peer=12D3KooW…&key=<22 url-safe characters>[&relay=<multiaddr>]
```

- `peer` is the host helper's identity, made fresh for each party. Dialling
  by identity means libp2p checks the remote key, so only that computer can
  answer.
- `key` is 128 random bits. The host's helper refuses any request without it,
  compared in constant time.
- `relay` is only there when the host uses a relay other than wavebit's. The
  invite then says so in amber.
- `at` lists up to six addresses of the host's computer, comma separated.
  A link is anything anyone can send, so the app refuses the whole link if
  one of them is loopback, link-local, unspecified, multicast or broadcast,
  an IPv4 address written as IPv6, or a port under 1024
  (`native/src/party/invite.rs`), and the helper checks them again. Home
  network addresses are allowed: they are how two computers on the same
  Wi-Fi meet. Nothing is dialled before Join is pressed.
- In an https invite link the key belongs after the `#`, which a browser
  never sends to the page's host.
- The **safety number** is 8 characters from the host's identity. The host
  sees it in the drawer and the friend sees it on the invite. Reading it out
  confirms the link wasn't swapped for someone else's.

## Rules

1. **A link never connects before a press.** Opening one shows the invite;
   nothing is sent to the computer or the relay until Join is pressed.
2. **The bridge only answers this computer's app.** It listens on
   `127.0.0.1` only, on a random port, and requires all of these:
   - a 256-bit secret made each launch, in `X-Wavebit-Bridge`
   - a `Host` header that is exactly its own address (this defeats DNS
     rebinding)
   - no `Origin` or `Sec-Fetch-Site` header (no web page can reach it)

   The secret lives in the main process and the Rust module, never in the
   page, settings or logs, like the party token.

3. **The helper is started with no arguments and an empty environment.** Its
   path is fixed, and its secrets go over stdin, where other programs can't
   read them as they can read a command line. It exits when wavebit closes
   its stdin, so it can't outlive the app. Its output is read as untrusted
   (`src/main/party/p2pRules.ts`).
4. **The host's helper limits each peer.** At most 4 open streams and 30 a
   minute. Five wrong keys shut that peer out for the rest of the party;
   more than 20 wrong keys a minute from anyone pause new peers for a minute.
   A friend can't make a party on the host's computer, only join the one
   there. Resource limits cap connections, streams and memory.
5. **Direct connections can be turned off.** A direct connection shows the
   people in the party your address on the internet. With _Allow direct
   connections_ off, the helper listens on nothing and refuses every
   connection that isn't to or through the relay.
6. **TCP and QUIC only.** No WebRTC or WebTransport, which a party doesn't
   need and which bring their own parsers of what strangers send.
7. **The relay is limited.** Each slot lasts an hour, at most 8 per address
   and 64 per network. A relayed connection lasts at most 30 minutes or
   32 MiB, and the app reconnects. Public libp2p relays allow 2 minutes or
   128 KiB, which is why wavebit runs its own.

## What it costs

- The helper adds about 26 MB to the app.
- Windows may ask once whether wavebit may accept connections. Saying no
  still works through the relay. On macOS the helper inherits wavebit's
  network permission.
- Running the relay is an ongoing cost. Its address goes in
  `WAVEBIT_RELAY` (`src/shared/schemas/party.ts`) once it is deployed; until
  then, parties are reached without one (see Without a relay) or through a
  relay address in Settings.
