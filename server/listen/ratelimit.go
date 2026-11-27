package listen

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/Wavebit-app/wavebit/server/config"
)

// ipRateLimiter allows limit events per key in each window.
type ipRateLimiter struct {
	mu      sync.Mutex
	window  time.Duration
	limit   int
	maxKeys int
	entries map[string]ipRateEntry
	swept   time.Time
}

type ipRateEntry struct {
	started time.Time
	count   int
}

func newIPRateLimiter(window time.Duration, limit, maxKeys int) *ipRateLimiter {
	return &ipRateLimiter{window: window, limit: limit, maxKeys: maxKeys, entries: make(map[string]ipRateEntry)}
}

func (l *ipRateLimiter) sweep(now time.Time) {
	if now.Sub(l.swept) < time.Second {
		return
	}
	for key, entry := range l.entries {
		if now.Sub(entry.started) >= l.window {
			delete(l.entries, key)
		}
	}
	l.swept = now
}

// Allow counts one event for key and reports whether it was within the limit.
// A full table makes room by forgetting an entry rather than refusing every
// new address.
func (l *ipRateLimiter) Allow(key string) bool {
	if l.limit <= 0 {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)
	entry := l.entries[key]
	if entry.started.IsZero() || now.Sub(entry.started) >= l.window {
		if entry.started.IsZero() && l.maxKeys > 0 && len(l.entries) >= l.maxKeys {
			for old := range l.entries {
				delete(l.entries, old)
				break
			}
		}
		l.entries[key] = ipRateEntry{started: now, count: 1}
		return true
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

// Exceeded reports whether key has used up its allowance, without counting.
func (l *ipRateLimiter) Exceeded(key string) bool {
	if l.limit <= 0 {
		return false
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	return ok && now.Sub(entry.started) < l.window && entry.count >= l.limit
}

// bucket is one shared allowance that refills evenly over a minute.
type bucket struct {
	mu     sync.Mutex
	perMin float64
	tokens float64
	at     time.Time
}

func newBucket(perMinute int) *bucket {
	return &bucket{perMin: float64(perMinute), tokens: float64(perMinute), at: time.Now()}
}

func (b *bucket) refill(now time.Time) {
	b.tokens += now.Sub(b.at).Minutes() * b.perMin
	if b.tokens > b.perMin {
		b.tokens = b.perMin
	}
	b.at = now
}

// Empty reports whether nothing is left, without spending.
func (b *bucket) Empty() bool {
	if b.perMin <= 0 {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill(time.Now())
	return b.tokens < 1
}

// Spend takes one if there is one.
func (b *bucket) Spend() {
	if b.perMin <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill(time.Now())
	if b.tokens >= 1 {
		b.tokens--
	}
}

// clientIP is the address a request came from. A forwarded address is only
// believed from a proxy in TrustedProxies, since anyone can write the header.
func clientIP(r *http.Request) netip.Addr {
	peer := remoteAddr(r)
	if !config.IsTrustedProxy(peer) {
		return peer
	}
	if header := config.ClientIPHeader; header != "" {
		if addr, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get(header))); err == nil {
			return addr.Unmap()
		}
		return peer
	}
	if config.TrustProxy {
		hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		// The rightmost hop is the one the trusted proxy itself added.
		for i := len(hops) - 1; i >= 0; i-- {
			if addr, err := netip.ParseAddr(strings.TrimSpace(hops[i])); err == nil {
				return addr.Unmap()
			}
		}
	}
	return peer
}

func remoteAddr(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return addr.Unmap()
}

// clientKey is what the limits count against: an IPv4 address, or an IPv6
// /64, since one home or phone is handed a whole /64 and can pick any address
// in it.
func clientKey(addr netip.Addr) string {
	if !addr.IsValid() {
		return "unknown"
	}
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.Prefix(64)
	if err != nil {
		return addr.String()
	}
	return prefix.String()
}

// requestKey is what one request's limits count against. Over libp2p (Host
// on this device) the remote address is the peer's identity rather than an
// IP, so each peer gets its own allowance instead of all of them sharing one.
func requestKey(r *http.Request) string {
	if addr := clientIP(r); addr.IsValid() {
		return clientKey(addr)
	}
	if id := r.RemoteAddr; id != "" && len(id) <= 100 && !strings.ContainsAny(id, " \t\r\n") {
		return "peer:" + id
	}
	return "unknown"
}

// requestNetworkKey is a wider net for IPv6: the /48 a site is usually
// handed, so rotating through its many /64s doesn't multiply anyone's
// allowance. Empty for IPv4, where a wider net would mostly catch strangers
// behind the same carrier.
func requestNetworkKey(r *http.Request) string {
	addr := clientIP(r)
	if !addr.IsValid() || addr.Is4() {
		return ""
	}
	prefix, err := addr.Prefix(48)
	if err != nil {
		return ""
	}
	return prefix.String()
}
