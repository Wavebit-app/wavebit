// Package clean makes text and addresses that arrive from clients safe to keep
// and to hand to every other member of a party.
//
// Names and titles are shown on other people's screens, so characters that
// change how text around them is read (direction overrides, zero-width
// joiners, line separators) are removed, and lengths are counted in characters
// so a cut never splits one.
package clean

import (
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Text keeps at most max characters of s, without control or format
// characters and with every run of white space folded to one space.
func Text(s string, max int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	var b strings.Builder
	b.Grow(min(len(s), max*4))
	count := 0
	space := false
	for _, r := range s {
		switch {
		case unicode.IsSpace(r) || r == ' ' || r == ' ':
			space = count > 0
			continue
		case r == '\u200D':
			// The zero-width joiner builds emoji sequences; keep it.
		case unicode.Is(unicode.Cc, r), unicode.Is(unicode.Cf, r), unicode.Is(unicode.Co, r):
			continue
		}
		if space {
			if count+1 >= max {
				break
			}
			b.WriteByte(' ')
			count++
			space = false
		}
		if count >= max {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}

// imageHosts are the picture hosts wavebit's own page will load from: Google
// and YouTube for accounts and songs, Spotify for covers. A picture anywhere
// else would make every member's device fetch it, telling its owner who is in
// the party, so it is dropped rather than passed on.
var imageHosts = []string{
	"googleusercontent.com",
	"ggpht.com",
	"ytimg.com",
	"scdn.co",
	"spotifycdn.com",
}

// ImageURL returns raw when it is an https address on one of imageHosts, and
// nil otherwise. Older clients sending something else lose the picture, not
// the request.
func ImageURL(raw string) *string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 1000 || !strings.HasPrefix(raw, "https://") {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	for _, allowed := range imageHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return &raw
		}
	}
	return nil
}

// VideoID reports whether id looks like a song id: 1 to 64 letters, digits,
// '-' or '_'. Anything else is never a song and is never passed on.
func VideoID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
