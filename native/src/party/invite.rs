//! Party codes, server addresses and invite links. All of it arrives from
//! outside (a pasted link, a link the system handed over, a settings field),
//! so nothing gets through that isn't a six-character code and a plain origin.

pub const CODE_LENGTH: usize = 6;
/// BitChord's public invite site; a link there means BitChord's own server.
const INVITE_HOST: &str = "bitchord.kushagrasingh.in";
/// BitChord's party server. A link that names no server was made by BitChord,
/// or by wavebit before it had its own server, so it means this one.
pub const BITCHORD_SERVER: &str = "https://api.bitchord.kushagrasingh.in";

/// Letters and digits only, upper case; None unless six are left.
pub fn clean_code(raw: &str) -> Option<String> {
    let code: String = raw
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    (code.len() == CODE_LENGTH).then_some(code)
}

/// `https://host[:port]`, or None. Plain http is for a server on this computer only.
pub fn clean_server(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed.len() > 200 {
        return None;
    }
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("https".to_string(), trimmed),
    };
    let (host, port) = match rest.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let host = host.to_ascii_lowercase();
    let host_ok = !host.is_empty()
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let port_ok =
        port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()));
    let local = host == "localhost" || host == "127.0.0.1";
    let scheme_ok = scheme == "https" || (scheme == "http" && local);
    if !host_ok || !port_ok || !scheme_ok {
        return None;
    }
    Some(match port {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

/// A server a link names: https, and a public name. A link is anything
/// anyone can send, so it never points wavebit at this computer, an address
/// typed as numbers, or a name only a local network knows. Settings may.
pub fn clean_link_server(raw: &str) -> Option<String> {
    let server = clean_server(raw)?;
    let host = server
        .strip_prefix("https://")?
        .split(':')
        .next()?
        .to_string();
    let local = host == "localhost"
        || [
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".home.arpa",
            ".intranet",
        ]
        .iter()
        .any(|suffix| host.ends_with(suffix));
    // A name, not a number: the last label has a letter in it.
    let named = host.contains('.')
        && host
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.chars().any(|c| c.is_ascii_alphabetic()));
    (!local && named).then_some(server)
}

/// A party on someone's computer: who to reach, the key their helper wants,
/// the relay to reach them through when it isn't wavebit's, and the
/// addresses the host's computer can be reached at directly.
#[derive(Debug, PartialEq)]
pub struct Peer {
    pub peer: String,
    pub key: String,
    pub relay: Option<String>,
    pub addrs: Vec<String>,
}

/// At most this many addresses for a host's computer in one link.
pub const MAX_HOST_ADDRS: usize = 6;

#[derive(Debug, PartialEq)]
pub struct Invite {
    pub code: String,
    /// None for a typed code (whichever server this device uses) and for a
    /// party on someone's computer.
    pub server: Option<String>,
    pub peer: Option<Peer>,
}

fn param(query: &str, name: &str) -> Option<String> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
        .map(percent_decode)
}

/// A libp2p peer id as wavebit's helper makes them (Ed25519, base58).
fn clean_peer(raw: &str) -> Option<String> {
    let ok = raw.starts_with("12D3KooW")
        && (46..=60).contains(&raw.len())
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() && !matches!(c, '0' | 'O' | 'I' | 'l'));
    ok.then(|| raw.to_string())
}

/// The invite's key: 22 to 64 url-safe base64 characters.
fn clean_key(raw: &str) -> Option<String> {
    let ok = (22..=64).contains(&raw.len())
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| raw.to_string())
}

/// A relay's address: a multiaddr over DNS or IP, TCP or QUIC, ending in the
/// relay's peer id. From a link, never one on this computer or a local
/// network, since a link is anything anyone can send; Settings may (`local`).
pub fn clean_relay(raw: &str) -> Option<String> {
    clean_relay_from(raw, false)
}

pub fn clean_relay_from(raw: &str, local: bool) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 300 {
        return None;
    }
    let parts: Vec<&str> = raw.split('/').collect();
    // "", proto, host, transport, port, [quic-v1], "p2p", id
    let (net, host) = (*parts.get(1)?, *parts.get(2)?);
    let named = matches!(net, "dns" | "dns4" | "dns6")
        && host.contains('.')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && (local || clean_link_server(host).is_some());
    let address = match net {
        "ip4" => host.parse::<std::net::Ipv4Addr>().ok().is_some_and(|ip| {
            !ip.is_unspecified()
                && (local || !(ip.is_loopback() || ip.is_private() || ip.is_link_local()))
        }),
        "ip6" => host.parse::<std::net::Ipv6Addr>().ok().is_some_and(|ip| {
            !ip.is_unspecified()
                && (local
                    || !(ip.is_loopback()
                        || (ip.segments()[0] & 0xfe00) == 0xfc00
                        || (ip.segments()[0] & 0xffc0) == 0xfe80))
        }),
        _ => false,
    };
    if !named && !address {
        return None;
    }
    let rest = &parts[3..];
    let ok = match rest {
        ["tcp", port, "p2p", id] | ["udp", port, "quic-v1", "p2p", id] => {
            port.parse::<u16>().is_ok_and(|p| p > 0) && clean_peer(id).is_some()
        }
        _ => false,
    };
    ok.then(|| raw.to_string())
}

/// One address a host's computer listens on, as its helper writes them:
/// `/ip4/<ip>/tcp/<port>` or `/ip4/<ip>/udp/<port>/quic-v1` (or ip6). The
/// peer id isn't part of it: the link's `peer` is, and libp2p checks it, so
/// an address that belongs to someone else fails the handshake.
///
/// A link is anything anyone can send, so it can never point at this
/// computer (loopback), an address that isn't one machine (unspecified,
/// multicast, broadcast), a link-local one, an IPv4 address dressed up as
/// IPv6, or a port under 1024 where system services listen. Addresses on a
/// home network stay allowed: a party between two computers on the same
/// Wi-Fi is what they are for.
pub fn clean_host_addr(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 80 {
        return None;
    }
    let parts: Vec<&str> = raw.split('/').collect();
    let (net, host) = (*parts.get(1)?, *parts.get(2)?);
    let ip_ok = match net {
        "ip4" => host.parse::<std::net::Ipv4Addr>().ok().is_some_and(|ip| {
            ip.octets()[0] != 0
                && !(ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_multicast()
                    || ip.is_broadcast())
                && ip.to_string() == host
        }),
        "ip6" => host.parse::<std::net::Ipv6Addr>().ok().is_some_and(|ip| {
            let first = ip.segments()[0];
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (first & 0xffc0) == 0xfe80
                || ip.to_ipv4_mapped().is_some()
                || ip.segments()[..6] == [0, 0, 0, 0, 0, 0])
        }),
        _ => false,
    };
    if !ip_ok || parts.first() != Some(&"") {
        return None;
    }
    let port_ok = |p: &str| {
        !p.starts_with('0') && p.parse::<u16>().is_ok_and(|p| p >= 1024)
    };
    let ok = match &parts[3..] {
        ["tcp", port] | ["udp", port, "quic-v1"] => port_ok(port),
        _ => false,
    };
    ok.then(|| raw.to_string())
}

/// The `at=` list of a link: comma-separated addresses, every one of them
/// usable, at most MAX_HOST_ADDRS, repeats dropped. Err refuses the link.
fn host_addrs(raw: &str) -> Result<Vec<String>, ()> {
    let mut out: Vec<String> = Vec::new();
    for part in raw.split(',').filter(|p| !p.trim().is_empty()) {
        let addr = clean_host_addr(part).ok_or(())?;
        if !out.contains(&addr) {
            out.push(addr);
        }
    }
    if out.len() > MAX_HOST_ADDRS {
        return Err(());
    }
    Ok(out)
}

/// A link to a party on someone's computer: `?peer=…&key=…[&relay=…][&at=…]`.
/// None when the link names no peer; Err when what it names isn't usable.
fn peer_params(query: &str) -> Result<Option<Peer>, ()> {
    let Some(peer) = param(query, "peer") else {
        return Ok(None);
    };
    let peer = clean_peer(&peer).ok_or(())?;
    let key = param(query, "key").and_then(|k| clean_key(&k)).ok_or(())?;
    let relay = match param(query, "relay") {
        None => None,
        Some(relay) => Some(clean_relay(&relay).ok_or(())?),
    };
    let addrs = match param(query, "at") {
        None => Vec::new(),
        Some(at) => host_addrs(&at)?,
    };
    Ok(Some(Peer {
        peer,
        key,
        relay,
        addrs,
    }))
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| raw.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The `server=` a link names: None when it names none, and Err when what it
/// names isn't a server a link may point at, which refuses the whole link.
fn server_param(query: &str) -> Result<Option<String>, ()> {
    match query
        .split('&')
        .find_map(|pair| pair.strip_prefix("server="))
    {
        None => Ok(None),
        Some(value) => clean_link_server(&percent_decode(value))
            .map(Some)
            .ok_or(()),
    }
}

/// A link's server: the one it names, else BitChord's.
fn link_server(query: &str) -> Option<String> {
    server_param(query)
        .ok()
        .map(|named| named.unwrap_or_else(|| BITCHORD_SERVER.to_string()))
}

/// A bare code, `wavebit://party/CODE`, BitChord's `bitchord://party/CODE`, an
/// `https://host/invite/CODE` page, or wavebit's own `https://…/invite/#CODE`.
/// `?server=` names another server.
pub fn parse_invite(text: &str) -> Option<Invite> {
    let text = text.trim();
    if text.len() > 1200 {
        return None;
    }
    let Some((scheme, rest)) = text.split_once("://") else {
        return clean_code(text).map(|code| Invite {
            code,
            server: None,
            peer: None,
        });
    };
    let (rest, fragment) = rest.split_once('#').unwrap_or((rest, ""));
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (host, path) = path.split_once('/').unwrap_or((path, ""));
    let path = path.trim_matches('/');
    let exact = |raw: &str| {
        (raw.len() == CODE_LENGTH)
            .then(|| clean_code(raw))
            .flatten()
    };
    match scheme.to_ascii_lowercase().as_str() {
        "wavebit" | "bitchord" if host.eq_ignore_ascii_case("party") => {
            let code = exact(path)?;
            // On someone's computer: no server, and the fragment may carry the key.
            let peer_query = if fragment.is_empty() {
                query.to_string()
            } else {
                format!("{query}&{fragment}")
            };
            match peer_params(&peer_query).ok()? {
                Some(peer) => Some(Invite {
                    code,
                    server: None,
                    peer: Some(peer),
                }),
                None => Some(Invite {
                    code,
                    server: Some(link_server(query)?),
                    peer: None,
                }),
            }
        }
        // wavebit's own invite page is static, so the code rides in the fragment,
        // which a browser never sends to the page's host.
        "https" if (path == "invite" || path.ends_with("/invite")) && !fragment.is_empty() => {
            Some(Invite {
                code: exact(fragment)?,
                server: Some(link_server(query)?),
                peer: None,
            })
        }
        "https" => {
            let code = exact(path.strip_prefix("invite/")?)?;
            let named = server_param(query).ok()?;
            // A custom server serves its own invite page, so its origin is the server.
            let own = if host.eq_ignore_ascii_case(INVITE_HOST) {
                Some(BITCHORD_SERVER.to_string())
            } else {
                Some(clean_link_server(&format!("https://{host}"))?)
            };
            Some(Invite {
                code,
                server: named.or(own),
                peer: None,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_read_charitably() {
        assert_eq!(clean_code("k7m 2qx"), Some("K7M2QX".into()));
        assert_eq!(clean_code("K7M-2QX"), Some("K7M2QX".into()));
        assert_eq!(clean_code("K7M2Q"), None);
        assert_eq!(clean_code("K7M2QXX"), None);
    }

    #[test]
    fn servers_must_be_plain_https_origins() {
        assert_eq!(
            clean_server("api.example.com/"),
            Some("https://api.example.com".into())
        );
        assert_eq!(
            clean_server("HTTPS://Party.Example.com:8443"),
            Some("https://party.example.com:8443".into())
        );
        assert_eq!(
            clean_server("http://localhost:8000"),
            Some("http://localhost:8000".into())
        );
        assert_eq!(clean_server("http://example.com"), None);
        assert_eq!(clean_server("https://user@example.com"), None);
        assert_eq!(clean_server("https://example.com/path"), None);
        assert_eq!(clean_server("file:///etc/passwd"), None);
        assert_eq!(clean_server(""), None);
    }

    #[test]
    fn links_never_point_at_this_computer_or_the_local_network() {
        for local in [
            "http://localhost:8000",
            "https://localhost",
            "https://127.0.0.1:8000",
            "https://192.168.1.1",
            "https://2130706433",
            "https://router.local",
            "https://nas.lan",
            "https://printer.home.arpa",
            "https://app.localhost",
            "http://party.example.com",
        ] {
            assert_eq!(clean_link_server(local), None, "{local}");
        }
        assert_eq!(
            clean_link_server("party.example.com"),
            Some("https://party.example.com".into())
        );
        // Settings still may.
        assert!(clean_server("http://127.0.0.1:8000").is_some());
    }

    #[test]
    fn invite_links_of_every_kind() {
        let typed = Some(Invite {
            code: "K7M2QX".into(),
            server: None,
            peer: None,
        });
        let bitchord = Some(Invite {
            code: "K7M2QX".into(),
            server: Some(BITCHORD_SERVER.into()),
            peer: None,
        });
        let custom = Some(Invite {
            code: "K7M2QX".into(),
            server: Some("https://party.example.com".into()),
            peer: None,
        });
        assert_eq!(parse_invite("k7m2qx"), typed);
        // A link with no server was made on BitChord's.
        assert_eq!(parse_invite("wavebit://party/K7M2QX"), bitchord);
        assert_eq!(parse_invite("bitchord://party/k7m2qx/"), bitchord);
        assert_eq!(
            parse_invite("https://bitchord.kushagrasingh.in/invite/K7M2QX"),
            bitchord
        );
        assert_eq!(
            parse_invite("wavebit://party/K7M2QX?server=https%3A%2F%2Fparty.example.com"),
            custom
        );
        assert_eq!(
            parse_invite("https://party.example.com/invite/K7M2QX"),
            custom
        );
    }

    #[test]
    fn wavebits_own_invite_page_carries_the_code_in_the_fragment() {
        assert_eq!(
            parse_invite("https://wavebit-app.github.io/wavebit/invite/#k7m2qx"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: Some(BITCHORD_SERVER.into()),
                peer: None,
            })
        );
        assert_eq!(
            parse_invite("https://example.org/invite/?server=party.example.com#K7M2QX"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: Some("https://party.example.com".into()),
                peer: None,
            })
        );
        // The page's host is never taken for a party server.
        assert_eq!(parse_invite("https://example.org/other/#K7M2QX"), None);
        assert_eq!(parse_invite("https://example.org/invite/#K7M2QXX"), None);
    }

    #[test]
    fn a_party_on_someones_computer() {
        let peer = "12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz";
        let key = "Abc_def-0123456789ghijkl";
        let link = format!("wavebit://party/K7M2QX?peer={peer}&key={key}");
        let invite = parse_invite(&link).unwrap();
        assert_eq!(invite.server, None);
        assert_eq!(
            invite.peer,
            Some(Peer {
                peer: peer.into(),
                key: key.into(),
                relay: None,
                addrs: vec![],
            })
        );
        // The key may ride in the fragment instead.
        let fragment = format!("wavebit://party/K7M2QX?peer={peer}#key={key}");
        assert_eq!(parse_invite(&fragment).unwrap().peer.unwrap().key, key);
        let relay = format!("/dns4/relay.example.com/udp/4001/quic-v1/p2p/{peer}");
        let with_relay = format!(
            "wavebit://party/K7M2QX?peer={peer}&key={key}&relay={}",
            relay.replace('/', "%2F")
        );
        assert_eq!(
            parse_invite(&with_relay).unwrap().peer.unwrap().relay,
            Some(relay)
        );
    }

    #[test]
    fn a_computer_link_that_isnt_right_is_refused_whole() {
        let peer = "12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz";
        let key = "Abc_def-0123456789ghijkl";
        for bad in [
            format!("wavebit://party/K7M2QX?peer={peer}"),
            format!("wavebit://party/K7M2QX?peer=QmNotEd25519&key={key}"),
            format!("wavebit://party/K7M2QX?peer={peer}&key=short"),
            format!(
                "wavebit://party/K7M2QX?peer={peer}&key={key}&relay=%2Fip4%2F127.0.0.1%2Ftcp%2F4001%2Fp2p%2F{peer}"
            ),
            format!(
                "wavebit://party/K7M2QX?peer={peer}&key={key}&relay=%2Fip4%2F192.168.1.2%2Ftcp%2F4001%2Fp2p%2F{peer}"
            ),
            format!(
                "wavebit://party/K7M2QX?peer={peer}&key={key}&relay=%2Fdns4%2Frouter.local%2Ftcp%2F4001%2Fp2p%2F{peer}"
            ),
            format!(
                "wavebit://party/K7M2QX?peer={peer}&key={key}&relay=%2Fdns4%2Frelay.example.com%2Ftcp%2F4001"
            ),
        ] {
            assert_eq!(parse_invite(&bad), None, "{bad}");
        }
        assert!(clean_relay(&format!("/ip4/203.0.113.9/tcp/4001/p2p/{peer}")).is_some());
    }

    #[test]
    fn a_host_computer_s_own_addresses() {
        let peer = "12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz";
        let key = "Abc_def-0123456789ghijkl";
        let at = "/ip4/203.0.113.9/tcp/40211,/ip4/192.168.1.20/udp/40212/quic-v1,/ip6/2001:db8::5/tcp/40211";
        let link = format!(
            "wavebit://party/K7M2QX?peer={peer}&key={key}&at={}",
            at.replace('/', "%2F").replace(',', "%2C")
        );
        let addrs = parse_invite(&link).unwrap().peer.unwrap().addrs;
        assert_eq!(addrs.len(), 3);
        // In the fragment too, where a browser never sends it anywhere.
        let fragment = format!("wavebit://party/K7M2QX?peer={peer}#key={key}&at={at}");
        assert_eq!(parse_invite(&fragment).unwrap().peer.unwrap().addrs.len(), 3);
    }

    #[test]
    fn a_link_never_points_at_this_computer_or_a_system_port() {
        for bad in [
            "/ip4/127.0.0.1/tcp/40211",
            "/ip4/0.0.0.0/tcp/40211",
            "/ip4/0.1.2.3/tcp/40211",
            "/ip4/169.254.1.1/tcp/40211",
            "/ip4/224.0.0.1/udp/40211/quic-v1",
            "/ip4/255.255.255.255/tcp/40211",
            "/ip4/192.168.1.2/tcp/22",
            "/ip4/192.168.1.2/tcp/0",
            "/ip4/192.168.1.2/tcp/080",
            "/ip4/192.168.1.2/tcp/70000",
            "/ip4/192.168.1.2/udp/40211",
            "/ip4/192.168.1.2/tcp/40211/p2p/12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz",
            "/ip4/192.168.001.2/tcp/40211",
            "/ip6/::1/tcp/40211",
            "/ip6/::/tcp/40211",
            "/ip6/fe80::1/tcp/40211",
            "/ip6/::ffff:127.0.0.1/tcp/40211",
            "/ip6/::127.0.0.1/tcp/40211",
            "/ip6/ff02::1/tcp/40211",
            "/dns4/example.com/tcp/40211",
            "ip4/192.168.1.2/tcp/40211",
        ] {
            assert_eq!(clean_host_addr(bad), None, "{bad}");
        }
        assert!(clean_host_addr("/ip4/10.0.0.4/tcp/40211").is_some());
        assert!(clean_host_addr("/ip6/2001:db8::5/udp/40211/quic-v1").is_some());
        // One bad address, or too many, refuses the whole link.
        let peer = "12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz";
        let key = "Abc_def-0123456789ghijkl";
        let one_bad = format!(
            "wavebit://party/K7M2QX?peer={peer}&key={key}&at=/ip4/10.0.0.4/tcp/40211,/ip4/127.0.0.1/tcp/40211"
        );
        assert_eq!(parse_invite(&one_bad), None);
        let many = (0..7)
            .map(|i| format!("/ip4/10.0.0.{}/tcp/40211", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let too_many = format!("wavebit://party/K7M2QX?peer={peer}&key={key}&at={many}");
        assert_eq!(parse_invite(&too_many), None);
    }

    #[test]
    fn anything_else_is_refused() {
        assert_eq!(parse_invite("wavebit://settings/K7M2QX"), None);
        assert_eq!(parse_invite("wavebit://party/K7M2QX/extra"), None);
        assert_eq!(parse_invite("wavebit://party/../../K7M2QX"), None);
        assert_eq!(parse_invite("http://example.com/invite/K7M2QX"), None);
        assert_eq!(parse_invite("javascript://party/K7M2QX"), None);
        // A link naming a server it may not point at is refused whole, not
        // quietly sent somewhere else.
        for bad in [
            "wavebit://party/K7M2QX?server=http://evil.example",
            "wavebit://party/K7M2QX?server=http%3A%2F%2F127.0.0.1%3A9000",
            "wavebit://party/K7M2QX?server=https%3A%2F%2Flocalhost",
            "https://127.0.0.1/invite/K7M2QX",
            "https://router.local/invite/K7M2QX",
        ] {
            assert_eq!(parse_invite(bad), None, "{bad}");
        }
    }
}
