package config

import (
	"log"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func getInt(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(val))
	if err != nil {
		return fallback
	}
	return parsed
}

func getCSV(key string, fallback string) []string {
	val := os.Getenv(key)
	if val == "" {
		val = fallback
	}
	if val == "" {
		return nil
	}
	var res []string
	for _, item := range strings.Split(val, ",") {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			res = append(res, trimmed)
		}
	}
	return res
}

func getBool(key string, fallback bool) bool {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(val))
	if err != nil {
		return fallback
	}
	return parsed
}

func getOrigin(key string) string {
	val := strings.TrimRight(strings.TrimSpace(os.Getenv(key)), "/")
	if val == "" {
		return ""
	}
	u, err := url.Parse(val)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		log.Printf("%s %q is not an http(s) origin; ignoring", key, val)
		return ""
	}
	return val
}

// IsAllowedOrigin deliberately does not support a wildcard. Browser clients
// must be explicitly named; native clients send no Origin header.
func IsAllowedOrigin(origin string) bool {
	for _, allowed := range AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func getString(key, fallback string) string {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		return val
	}
	return fallback
}

func getCIDRs(key, fallback string) []netip.Prefix {
	var out []netip.Prefix
	for _, item := range getCSV(key, fallback) {
		prefix, err := netip.ParsePrefix(item)
		if err != nil {
			addr, addrErr := netip.ParseAddr(item)
			if addrErr != nil {
				log.Printf("%s: %q is not an address or CIDR; ignoring", key, item)
				continue
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		out = append(out, prefix.Masked())
	}
	return out
}

// IsTrustedProxy reports whether a request's direct peer is a proxy whose
// client-address header may be believed.
func IsTrustedProxy(addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, prefix := range TrustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

var (
	MaxMembers           = getInt("JAM_MAX_MEMBERS", 5)
	StateHeartbeatMs     = getInt("JAM_STATE_HEARTBEAT_MS", 5000)
	PlayLeadMs           = getInt("JAM_PLAY_LEAD_MS", 350)
	DisconnectGraceMs    = int64(getInt("JAM_DISCONNECT_GRACE_MS", 45000))
	EmptyPartyTTLMs      = int64(getInt("JAM_EMPTY_PARTY_TTL_MS", 120000))
	PartyMaxAgeMs        = int64(getInt("JAM_PARTY_MAX_AGE_MS", 12*60*60*1000))
	ControlRatePerSecond = float64(getInt("JAM_CONTROL_RATE_PER_SECOND", 25))
	MaxUpcomingQueue     = getInt("JAM_MAX_UPCOMING_QUEUE", 25)
	MaxQueueLength       = getInt("JAM_MAX_QUEUE_LENGTH", 1+MaxUpcomingQueue)
	// MaxQueueTotal caps a party's queue, the songs already played included.
	MaxQueueTotal = getInt("JAM_MAX_QUEUE_TOTAL", 100)
	// Render Free has 0.1 CPU. Fifty rooms (at most 250 sockets) is a safe
	// starting ceiling; raise it only after measuring CPU and memory usage.
	MaxParties = getInt("JAM_MAX_PARTIES", 50)
	// Carriers put many phones behind one IPv4 address, so these are not tight.
	CreateRatePerMinute = getInt("JAM_CREATE_RATE_PER_MINUTE", 3)
	// MaxPartiesPerClient is how many live parties one address (an IPv6 /64)
	// may hold at once, so a few addresses can't fill MaxParties.
	MaxPartiesPerClient = getInt("JAM_MAX_PARTIES_PER_CLIENT", 5)
	// MaxPartiesPerNetwork is the same for an IPv6 /48, the block a site gets.
	MaxPartiesPerNetwork = getInt("JAM_MAX_PARTIES_PER_NETWORK", 10)
	// UnclaimedPartyTTLMs drops a party nobody ever connected to.
	UnclaimedPartyTTLMs = int64(getInt("JAM_UNCLAIMED_PARTY_TTL_MS", 30000))
	RateLimitMaxEntries = getInt("JAM_RATE_LIMIT_MAX_ENTRIES", 10000)
	// Anything that takes a party code. Misses (no such party, a wrong token)
	// have a much smaller allowance, which is what makes guessing codes slow.
	LookupRatePerMinute      = getInt("JAM_LOOKUP_RATE_PER_MINUTE", 120)
	MissRatePerMinute        = getInt("JAM_MISS_RATE_PER_MINUTE", 12)
	MissRatePerNetworkMinute = getInt("JAM_MISS_RATE_PER_NETWORK_MINUTE", 60)
	GlobalMissRatePerMinute  = getInt("JAM_GLOBAL_MISS_RATE_PER_MINUTE", 1200)
	RequestMaxBytes          = int64(getInt("JAM_REQUEST_MAX_BYTES", 16*1024))
	WebSocketMaxBytes        = int64(getInt("JAM_WEBSOCKET_MAX_BYTES", 16*1024))
	ConnectionIdleMs         = int64(getInt("JAM_CONNECTION_IDLE_MS", 15*60*1000))
	FrameRatePerSecond       = float64(getInt("JAM_FRAME_RATE_PER_SECOND", 30))
	// A socket that keeps going over its frame budget is closed after this many.
	MaxBudgetViolations = getInt("JAM_MAX_BUDGET_VIOLATIONS", 20)
	// The server pings every socket, and one that answers nothing in PongWaitMs
	// is gone: a phone that lost signal stops holding its place.
	PingIntervalMs = int64(getInt("JAM_PING_INTERVAL_MS", 30000))
	PongWaitMs     = int64(getInt("JAM_PONG_WAIT_MS", 75000))
	// SendQueueFrames is how far a device may fall behind before it is dropped
	// rather than allowed to slow everybody else down.
	SendQueueFrames = getInt("JAM_SEND_QUEUE_FRAMES", 64)
	SendQueueBytes  = int64(getInt("JAM_SEND_QUEUE_BYTES", 2<<20))
	// Queue edits each send the whole queue to everyone, so they have an
	// allowance of their own, smaller than other controls'.
	QueueEditsPerSecond = float64(getInt("JAM_QUEUE_EDITS_PER_SECOND", 4))
	QueueEditBurst      = float64(getInt("JAM_QUEUE_EDIT_BURST", 10))
	// Reactions: per member, then for the whole party.
	ReactRatePerSecond      = float64(getInt("JAM_REACT_RATE_PER_SECOND", 3))
	ReactBurst              = float64(getInt("JAM_REACT_BURST", 5))
	PartyReactRatePerSecond = float64(getInt("JAM_PARTY_REACT_RATE", 15))
	AllowedOrigins          = getCSV("JAM_ALLOWED_ORIGINS", "")
	// TrustProxy reads the rightmost X-Forwarded-For hop, and only from a
	// TrustedProxies peer. ClientIPHeader names a single header to read instead
	// (Caddy's X-Real-IP, say), with the same rule about who may set it.
	TrustProxy     = getBool("JAM_TRUST_PROXY", false)
	ClientIPHeader = getString("JAM_CLIENT_IP_HEADER", "")
	TrustedProxies = getCIDRs("JAM_TRUSTED_PROXIES", "127.0.0.1/32,::1/128")
	PublicOrigin   = getOrigin("JAM_PUBLIC_ORIGIN")
	Port           = getInt("PORT", 8000)
	// ListenAddr is loopback by default: the server is meant to sit behind a
	// proxy that terminates TLS. Docker sets 0.0.0.0 inside its own network.
	ListenAddr = getString("JAM_LISTEN_ADDR", "127.0.0.1:"+strconv.Itoa(Port))
)
