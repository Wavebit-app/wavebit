//! Party codes, server addresses and invite links. All of it arrives from
//! outside (a pasted link, a link the system handed over, a settings field),
//! so nothing gets through that isn't a six-character code and a plain origin.

pub const CODE_LENGTH: usize = 6;
/// BitChord's public invite site; a link there means BitChord's own server.
const INVITE_HOST: &str = "bitchord.kushagrasingh.in";

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

#[derive(Debug, PartialEq)]
pub struct Invite {
    pub code: String,
    /// None means whichever server this device already uses.
    pub server: Option<String>,
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

fn server_param(query: &str) -> Option<String> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("server="))
        .and_then(|value| clean_server(&percent_decode(value)))
}

/// A bare code, `wavebit://party/CODE`, BitChord's `bitchord://party/CODE`, an
/// `https://host/invite/CODE` page, or wavebit's own `https://…/invite/#CODE`.
/// `?server=` names another server.
pub fn parse_invite(text: &str) -> Option<Invite> {
    let text = text.trim();
    if text.len() > 600 {
        return None;
    }
    let Some((scheme, rest)) = text.split_once("://") else {
        return clean_code(text).map(|code| Invite { code, server: None });
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
        "wavebit" | "bitchord" if host.eq_ignore_ascii_case("party") => Some(Invite {
            code: exact(path)?,
            server: server_param(query),
        }),
        // wavebit's own invite page is static, so the code rides in the fragment,
        // which a browser never sends to the page's host.
        "https" if (path == "invite" || path.ends_with("/invite")) && !fragment.is_empty() => {
            Some(Invite {
                code: exact(fragment)?,
                server: server_param(query),
            })
        }
        "https" => {
            let code = exact(path.strip_prefix("invite/")?)?;
            // A custom server serves its own invite page, so its origin is the server.
            let own = (!host.eq_ignore_ascii_case(INVITE_HOST))
                .then(|| clean_server(&format!("https://{host}")))
                .flatten();
            Some(Invite {
                code,
                server: server_param(query).or(own),
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
    fn invite_links_of_every_kind() {
        let plain = |code: &str| {
            Some(Invite {
                code: code.into(),
                server: None,
            })
        };
        assert_eq!(parse_invite("k7m2qx"), plain("K7M2QX"));
        assert_eq!(parse_invite("wavebit://party/K7M2QX"), plain("K7M2QX"));
        assert_eq!(parse_invite("bitchord://party/k7m2qx/"), plain("K7M2QX"));
        assert_eq!(
            parse_invite("https://bitchord.kushagrasingh.in/invite/K7M2QX"),
            plain("K7M2QX")
        );
        assert_eq!(
            parse_invite("wavebit://party/K7M2QX?server=https%3A%2F%2Fparty.example.com"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: Some("https://party.example.com".into()),
            })
        );
        assert_eq!(
            parse_invite("https://party.example.com/invite/K7M2QX"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: Some("https://party.example.com".into()),
            })
        );
    }

    #[test]
    fn wavebits_own_invite_page_carries_the_code_in_the_fragment() {
        let plain = Some(Invite {
            code: "K7M2QX".into(),
            server: None,
        });
        assert_eq!(
            parse_invite("https://wavebit-app.github.io/wavebit/invite/#k7m2qx"),
            plain
        );
        assert_eq!(parse_invite("https://example.org/invite#K7M2QX"), plain);
        assert_eq!(
            parse_invite("https://example.org/invite/?server=party.example.com#K7M2QX"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: Some("https://party.example.com".into()),
            })
        );
        // The page's host is never taken for a party server.
        assert_eq!(parse_invite("https://example.org/other/#K7M2QX"), None);
        assert_eq!(parse_invite("https://example.org/invite/#K7M2QXX"), None);
    }

    #[test]
    fn anything_else_is_refused() {
        assert_eq!(parse_invite("wavebit://settings/K7M2QX"), None);
        assert_eq!(parse_invite("wavebit://party/K7M2QX/extra"), None);
        assert_eq!(parse_invite("wavebit://party/../../K7M2QX"), None);
        assert_eq!(parse_invite("http://example.com/invite/K7M2QX"), None);
        assert_eq!(parse_invite("javascript://party/K7M2QX"), None);
        // A server that isn't an https origin is dropped, not followed.
        assert_eq!(
            parse_invite("wavebit://party/K7M2QX?server=http://evil.example"),
            Some(Invite {
                code: "K7M2QX".into(),
                server: None,
            })
        );
    }
}
