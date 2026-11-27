package p2p

import (
	"crypto/subtle"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// BridgeHeader carries the bridge's secret from the app to its helper.
const BridgeHeader = "X-Wavebit-Bridge"

// PartyKeyHeader carries the invite's key from a joiner's helper to the host's.
const PartyKeyHeader = "X-Wavebit-Party-Key"

// Bridge serves the app on 127.0.0.1. It answers only this computer's app:
// the per-launch secret must be in BridgeHeader, the Host header must be the
// bridge's own address (which defeats DNS rebinding), and anything a browser
// would add (Origin, Sec-Fetch-Site) is refused, so no web page can reach it.
func Bridge(secret string, listener net.Listener, next http.Handler) *http.Server {
	want := []byte(secret)
	own := listener.Addr().String()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != own ||
			r.Header.Get("Origin") != "" ||
			r.Header.Get("Sec-Fetch-Site") != "" ||
			subtle.ConstantTimeCompare([]byte(r.Header.Get(BridgeHeader)), want) != 1 {
			http.Error(w, "not for you", http.StatusForbidden)
			return
		}
		r.Header.Del(BridgeHeader)
		next.ServeHTTP(w, r)
	})
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}

// peerGuard keeps what one peer can do on the host small: a few streams at a
// time, a few dozen a minute, and a handful of wrong keys before it is shut
// out for the rest of the party. Too many wrong keys from anyone pauses new
// peers for a minute, but never a peer that has shown the key: a stranger
// who knows the host's identity from an invite can't keep the party's own
// members out.
type peerGuard struct {
	mu        sync.Mutex
	open      map[peer.ID]int
	recent    map[peer.ID][]time.Time
	bad       map[peer.ID]int
	trusted   map[peer.ID]bool
	badGlobal []time.Time
	pausedTil time.Time
}

const (
	maxOpenPerPeer    = 4
	maxPerMinute      = 30
	maxBadPerPeer     = 5
	maxBadGlobalMin   = 20
	globalPauseLength = time.Minute
	// maxTracked bounds the guard's memory: fresh peer ids are free.
	maxTracked = 1024
)

func newPeerGuard() *peerGuard {
	return &peerGuard{
		open:    make(map[peer.ID]int),
		recent:  make(map[peer.ID][]time.Time),
		bad:     make(map[peer.ID]int),
		trusted: make(map[peer.ID]bool),
	}
}

// admit decides on a new stream from p.
func (g *peerGuard) admit(p peer.ID) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	if (!g.trusted[p] && now.Before(g.pausedTil)) || g.bad[p] >= maxBadPerPeer || g.open[p] >= maxOpenPerPeer {
		return false
	}
	kept := g.recent[p][:0]
	for _, t := range g.recent[p] {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	if len(kept) >= maxPerMinute {
		g.recent[p] = kept
		return false
	}
	if len(g.recent) >= maxTracked {
		g.prune(now)
	}
	g.recent[p] = append(kept, now)
	g.open[p]++
	return true
}

// prune forgets peers with nothing recent and nothing open.
func (g *peerGuard) prune(now time.Time) {
	for p, times := range g.recent {
		if g.open[p] == 0 && (len(times) == 0 || now.Sub(times[len(times)-1]) >= time.Minute) {
			delete(g.recent, p)
		}
	}
	if len(g.bad) >= maxTracked {
		// Peers shut out for good keep their place; the rest are forgotten.
		for p, n := range g.bad {
			if n < maxBadPerPeer {
				delete(g.bad, p)
			}
		}
	}
}

func (g *peerGuard) done(p peer.ID) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.open[p] > 1 {
		g.open[p]--
	} else {
		delete(g.open, p)
	}
}

// keyed records that p showed the right key.
func (g *peerGuard) keyed(p peer.ID) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.trusted) < maxTracked {
		g.trusted[p] = true
	}
}

func (g *peerGuard) isTrusted(p peer.ID) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.trusted[p]
}

func (g *peerGuard) wrongKey(p peer.ID) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	if len(g.bad) >= maxTracked {
		g.prune(now)
	}
	g.bad[p]++
	kept := g.badGlobal[:0]
	for _, t := range g.badGlobal {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	g.badGlobal = append(kept, now)
	if len(g.badGlobal) > maxBadGlobalMin {
		g.pausedTil = now.Add(globalPauseLength)
		g.badGlobal = nil
	}
}

// trackedConn tells the guard when its stream ends.
type trackedConn struct {
	streamConn
	once sync.Once
	g    *peerGuard
}

func (c *trackedConn) Close() error {
	c.once.Do(func() { c.g.done(c.Conn().RemotePeer()) })
	return c.streamConn.Close()
}

// keyGrace is how long a connected peer has to show the invite's key.
const keyGrace = 15 * time.Second

// ServeParty answers joiners on the host: the party server's routes, for a
// peer that holds the invite's key. Creating a party is refused here; the
// host's party is made through the bridge.
func ServeParty(n *Node, key string, party http.Handler) (stop func()) {
	guard := newPeerGuard()
	want := []byte(key)
	l := newStreamListener(n.Host.ID(), func(s network.Stream) bool {
		return guard.admit(s.Conn().RemotePeer())
	})
	l.release = func(s network.Stream) { guard.done(s.Conn().RemotePeer()) }
	n.Host.SetStreamHandler(ProtocolID, l.handle)
	// A peer that connects and never shows the key within keyGrace is
	// disconnected, so idle strangers can't hold the host's connections or
	// the relay's circuits to it.
	watch := &network.NotifyBundle{ConnectedF: func(_ network.Network, c network.Conn) {
		p := c.RemotePeer()
		if p == n.Relay.ID {
			return
		}
		time.AfterFunc(keyGrace, func() {
			if !guard.isTrusted(p) && n.Host.Network().Connectedness(p) == network.Connected {
				_ = n.Host.Network().ClosePeer(p)
			}
		})
	}}
	n.Host.Network().Notify(watch)
	tracked := &trackingListener{streamListener: l, g: guard}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		from, _ := peer.Decode(r.RemoteAddr)
		if subtle.ConstantTimeCompare([]byte(r.Header.Get(PartyKeyHeader)), want) != 1 {
			guard.wrongKey(from)
			// The stream ends here, so the next try opens a new one and
			// passes the guard again.
			w.Header().Set("Connection", "close")
			http.Error(w, "no such party", http.StatusNotFound)
			return
		}
		r.Header.Del(PartyKeyHeader)
		guard.keyed(from)
		if r.Method == http.MethodPost && strings.TrimRight(r.URL.Path, "/") == "/api/parties" {
			http.Error(w, "parties are made on the host", http.StatusForbidden)
			return
		}
		party.ServeHTTP(w, r)
	})
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() { _ = server.Serve(tracked) }()
	return func() {
		n.Host.Network().StopNotify(watch)
		n.Host.RemoveStreamHandler(ProtocolID)
		_ = server.Close()
		_ = l.Close()
	}
}

type trackingListener struct {
	*streamListener
	g *peerGuard
}

func (l *trackingListener) Accept() (net.Conn, error) {
	c, err := l.streamListener.Accept()
	if err != nil {
		return nil, err
	}
	return &trackedConn{streamConn: c.(streamConn), g: l.g}, nil
}

// Proxy is the joiner's side: every request from the app goes to the host
// over a libp2p stream, with the invite's key added. WebSocket upgrades pass
// through.
func Proxy(n *Node, host peer.ID, key string) http.Handler {
	target, _ := url.Parse("http://party.invalid")
	proxy := httputil.NewSingleHostReverseProxy(target)
	direct := proxy.Director
	proxy.Director = func(r *http.Request) {
		direct(r)
		r.Host = "party.invalid"
		r.Header.Set(PartyKeyHeader, key)
		r.Header.Del("X-Forwarded-For")
	}
	proxy.Transport = &http.Transport{
		DialContext:           dialer(n, host),
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "host unreachable", http.StatusBadGateway)
	}
	return proxy
}
