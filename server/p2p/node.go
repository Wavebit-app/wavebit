package p2p

import (
	"context"
	"errors"
	"fmt"
	"net"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/control"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/host/observedaddrs"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	"github.com/libp2p/go-libp2p/p2p/net/connmgr"
	"github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	libp2ptls "github.com/libp2p/go-libp2p/p2p/security/tls"
	quic "github.com/libp2p/go-libp2p/p2p/transport/quic"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ma "github.com/multiformats/go-multiaddr"
	manet "github.com/multiformats/go-multiaddr/net"
)

// libp2p believes an outside address for this computer once 4 different
// peers report it, which suits the public IPFS network. A party computer talks
// to one relay and a few friends, so it would never believe one, and without
// one it never tries to connect directly. One report is enough here; the
// relay is the one making it, and a wrong one only costs a failed attempt.
// Set once, before any node starts reading it.
func init() { observedaddrs.ActivationThresh = 1 }

// ProtocolID is the party protocol (HTTP and its WebSocket upgrade) between
// a joiner's helper and the host's.
const ProtocolID = protocol.ID("/wavebit/party/http/1.0.0")

// Node is this computer on the libp2p network: a fresh identity every time,
// no DHT, no bootstrap peers, no local discovery. It only ever talks to the
// relay it was given (when there is one) and the peer an invite names.
type Node struct {
	Host   host.Host
	Relay  peer.AddrInfo
	Direct bool
}

// NodeOptions are what the app chose.
type NodeOptions struct {
	// Relay is a multiaddr ending in /p2p/<id>, or empty for none: then
	// joiners reach the host only at the addresses its invite lists (the same
	// network, or a port its router opened), and Direct must be on.
	Relay string
	// Direct allows connections that don't go through the relay, and with
	// them hole punching. Off, nobody in the party learns this computer's
	// address from it.
	Direct bool
	// MapPort asks the router to forward a port (UPnP or NAT-PMP). Only a
	// host needs one; a guest only ever dials out.
	MapPort bool
	// OnlyPeer, for a guest, is the host: every connection with any other
	// peer (but the relay) is refused, so a guest's helper talks to nobody
	// else whatever reaches it.
	OnlyPeer peer.ID
}

// ParseRelay reads a relay address. It must name the relay's peer id, so
// the relay is authenticated like everyone else.
func ParseRelay(s string) (peer.AddrInfo, error) {
	addr, err := ma.NewMultiaddr(strings.TrimSpace(s))
	if err != nil {
		return peer.AddrInfo{}, fmt.Errorf("relay address: %w", err)
	}
	info, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return peer.AddrInfo{}, fmt.Errorf("relay address needs /p2p/<id>: %w", err)
	}
	return *info, nil
}

// gater refuses every connection that isn't to the relay or through it, when
// direct connections are off.
type gater struct {
	relay  peer.ID
	direct bool
	only   peer.ID
}

// known reports whether p may talk to this node at all.
func (g gater) known(p peer.ID) bool {
	return g.only == "" || p == g.only || (g.relay != "" && p == g.relay)
}

func relayed(addr ma.Multiaddr) bool {
	_, err := addr.ValueForProtocol(ma.P_CIRCUIT)
	return err == nil
}

func (g gater) InterceptPeerDial(p peer.ID) bool { return g.known(p) }
func (g gater) InterceptAddrDial(p peer.ID, addr ma.Multiaddr) bool {
	return g.known(p) && (g.direct || p == g.relay || relayed(addr))
}
func (g gater) InterceptAccept(addrs network.ConnMultiaddrs) bool {
	return g.direct || relayed(addrs.RemoteMultiaddr())
}
func (g gater) InterceptSecured(_ network.Direction, p peer.ID, addrs network.ConnMultiaddrs) bool {
	return g.known(p) && (g.direct || p == g.relay || relayed(addrs.RemoteMultiaddr()))
}
func (g gater) InterceptUpgraded(network.Conn) (bool, control.DisconnectReason) {
	return true, 0
}

// limits keep the helper small whatever a peer sends: it serves one party of
// at most ten devices.
func limits() rcmgr.ConcreteLimitConfig {
	base := rcmgr.DefaultLimits
	libp2p.SetDefaultServiceLimits(&base)
	scaled := base.Scale(64<<20, 256)
	partial := rcmgr.PartialLimitConfig{
		System: rcmgr.ResourceLimits{
			Conns:         64,
			ConnsInbound:  32,
			ConnsOutbound: 32,
			Streams:       256,
			Memory:        64 << 20,
		},
		PeerDefault: rcmgr.ResourceLimits{
			Conns:          4,
			Streams:        16,
			StreamsInbound: 8,
			Memory:         8 << 20,
		},
	}
	return partial.Build(scaled)
}

// ErrNoPath is NewNode's answer to no relay and no direct connections:
// nobody could ever reach this computer, or be reached from it.
var ErrNoPath = errors.New("no relay and no direct connections")

// NewNode starts this computer's libp2p host.
func NewNode(opts NodeOptions) (*Node, error) {
	var relayInfo peer.AddrInfo
	if strings.TrimSpace(opts.Relay) != "" {
		var err error
		if relayInfo, err = ParseRelay(opts.Relay); err != nil {
			return nil, err
		}
	} else if !opts.Direct {
		return nil, ErrNoPath
	}
	priv, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		return nil, err
	}
	rm, err := rcmgr.NewResourceManager(rcmgr.NewFixedLimiter(limits()))
	if err != nil {
		return nil, err
	}
	cm, err := connmgr.NewConnManager(4, 24, connmgr.WithGracePeriod(time.Minute))
	if err != nil {
		return nil, err
	}
	options := []libp2p.Option{
		libp2p.Identity(priv),
		// TCP and QUIC only: no WebRTC or WebTransport, which a party doesn't
		// need and which bring their own parsers of what strangers send.
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Transport(quic.NewTransport),
		libp2p.Security(noise.ID, noise.New),
		libp2p.Security(libp2ptls.ID, libp2ptls.New),
		libp2p.ResourceManager(rm),
		libp2p.ConnectionManager(cm),
		libp2p.ConnectionGater(gater{relay: relayInfo.ID, direct: opts.Direct, only: opts.OnlyPeer}),
		libp2p.EnableRelay(),
		libp2p.DisableMetrics(),
		libp2p.UserAgent("wavebit"),
	}
	if opts.Direct {
		options = append(options,
			libp2p.ListenAddrStrings(
				"/ip4/0.0.0.0/tcp/0",
				"/ip4/0.0.0.0/udp/0/quic-v1",
				"/ip6/::/tcp/0",
				"/ip6/::/udp/0/quic-v1",
			),
			libp2p.EnableHolePunching(),
			libp2p.EnableAutoNATv2(),
		)
		if opts.MapPort {
			// Asks the router (UPnP or NAT-PMP) to forward a port to this
			// helper, so friends elsewhere can reach a party with no relay.
			// The mapping is removed when the helper closes.
			options = append(options, libp2p.NATPortMap())
		}
	} else {
		options = append(options, libp2p.NoListenAddrs)
	}
	h, err := libp2p.New(options...)
	if err != nil {
		return nil, err
	}
	return &Node{Host: h, Relay: relayInfo, Direct: opts.Direct}, nil
}

// Close stops the host.
func (n *Node) Close() error { return n.Host.Close() }

// HasRelay reports whether this node was given a relay.
func (n *Node) HasRelay() bool { return n.Relay.ID != "" }

// ConnectRelay connects to the relay.
func (n *Node) ConnectRelay(ctx context.Context) error {
	if !n.HasRelay() {
		return ErrNoPath
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return n.Host.Connect(ctx, n.Relay)
}

// KeepReservation holds a slot on the relay so joiners can reach this host
// through it, renewing it before it runs out, until ctx ends. ready is called
// after the first reservation.
func (n *Node) KeepReservation(ctx context.Context, ready func(error)) {
	first := true
	for {
		var expires time.Time
		err := n.ConnectRelay(ctx)
		if err == nil {
			var r *client.Reservation
			r, err = client.Reserve(ctx, n.Host, n.Relay)
			if err == nil {
				expires = r.Expiration
			}
		}
		if first {
			ready(err)
			first = false
		}
		wait := 20 * time.Second
		if err == nil {
			wait = time.Until(expires) / 2
			if wait < 30*time.Second {
				wait = 30 * time.Second
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// CircuitAddr is how a joiner reaches this host: through the relay.
func (n *Node) CircuitAddr() ma.Multiaddr {
	addr := n.Relay.Addrs[0].
		Encapsulate(ma.StringCast("/p2p/" + n.Relay.ID.String())).
		Encapsulate(ma.StringCast("/p2p-circuit"))
	return addr
}

// dcutr is libp2p's hole punching protocol.
const dcutr = protocol.ID("/libp2p/dcutr")

// waitFor polls ok every 100 ms until it holds or within runs out.
func waitFor(ctx context.Context, within time.Duration, ok func() bool) bool {
	deadline := time.Now().Add(within)
	for !ok() {
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(100 * time.Millisecond):
		}
	}
	return true
}

// ConnectHost connects a joiner to the host through the relay. Hole punching
// then moves the connection to a direct one when both sides allow it.
//
// The host starts hole punching the moment this connection arrives, and only
// once. This side only answers after it has learned its own public address
// from the relay, so it waits for that first; when no direct connection
// appears it connects again, which gives the host a second try. All of it
// happens before the app's party traffic starts.
//
// addrs are the addresses the invite listed for the host's computer. They
// are tried first, straight there, and are the only way in without a relay.
func (n *Node) ConnectHost(ctx context.Context, hostID peer.ID, addrs []ma.Multiaddr) error {
	if n.Direct && len(addrs) > 0 {
		dial, cancel := context.WithTimeout(network.WithForceDirectDial(ctx, "wavebit party"), 8*time.Second)
		err := n.Host.Connect(dial, peer.AddrInfo{ID: hostID, Addrs: addrs})
		cancel()
		if err == nil && n.directTo(hostID) {
			return nil
		}
		if !n.HasRelay() {
			if err == nil {
				err = ErrNoPath
			}
			return err
		}
	}
	if err := n.ConnectRelay(ctx); err != nil {
		return err
	}
	if n.Direct {
		waitFor(ctx, 6*time.Second, func() bool {
			return slices.Contains(n.Host.Mux().Protocols(), dcutr)
		})
	}
	connect := func() error {
		ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		ctx = network.WithAllowLimitedConn(ctx, "wavebit party")
		return n.Host.Connect(ctx, peer.AddrInfo{ID: hostID, Addrs: []ma.Multiaddr{n.CircuitAddr()}})
	}
	if err := connect(); err != nil {
		return err
	}
	if !n.Direct || waitFor(ctx, 3*time.Second, func() bool { return n.directTo(hostID) }) {
		return nil
	}
	_ = n.Host.Network().ClosePeer(hostID)
	if err := connect(); err != nil {
		return err
	}
	waitFor(ctx, 3*time.Second, func() bool { return n.directTo(hostID) })
	return nil
}

// Links counts the peers other than the relay by how they are connected.
func (n *Node) Links() (direct, relayedOnly int) {
	for _, p := range n.Host.Network().Peers() {
		if p == n.Relay.ID {
			continue
		}
		hasDirect := false
		for _, c := range n.Host.Network().ConnsToPeer(p) {
			if !relayed(c.RemoteMultiaddr()) {
				hasDirect = true
			}
		}
		if hasDirect {
			direct++
		} else {
			relayedOnly++
		}
	}
	return direct, relayedOnly
}

// directTo reports whether p has a connection that doesn't go through the relay.
func (n *Node) directTo(p peer.ID) bool {
	for _, c := range n.Host.Network().ConnsToPeer(p) {
		if !relayed(c.RemoteMultiaddr()) {
			return true
		}
	}
	return false
}

// TryLocal dials the addresses the host announced itself, for two computers
// on the same network or the same machine: libp2p's hole punching only uses
// public addresses. Their identities are checked as always, so an address
// that turns out to be someone else's fails the handshake.
func (n *Node) TryLocal(ctx context.Context, p peer.ID) bool {
	if !n.Direct || n.directTo(p) {
		return n.directTo(p)
	}
	var addrs []ma.Multiaddr
	for _, a := range n.Host.Peerstore().Addrs(p) {
		if !relayed(a) {
			addrs = append(addrs, a)
		}
	}
	if len(addrs) == 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(network.WithForceDirectDial(ctx, "wavebit same network"), 6*time.Second)
	defer cancel()
	return n.Host.Connect(ctx, peer.AddrInfo{ID: p, Addrs: addrs}) == nil && n.directTo(p)
}

// MoveOffRelay closes relayed connections to every peer that also has a
// direct one, until ctx ends. A party's socket on the relayed connection
// closes with it and the app reconnects, directly this time, which keeps the
// relay free for the parties that need it.
func (n *Node) MoveOffRelay(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		for _, p := range n.Host.Network().Peers() {
			if p == n.Relay.ID || !n.directTo(p) {
				continue
			}
			for _, c := range n.Host.Network().ConnsToPeer(p) {
				// A direct connection younger than a second may still be settling.
				if relayed(c.RemoteMultiaddr()) && time.Since(c.Stat().Opened) > time.Second {
					_ = c.Close()
				}
			}
		}
	}
}

// shareable reports whether addr is one a friend could dial: IPv4 or IPv6,
// TCP or QUIC, nothing relayed, and not loopback, link-local or unspecified.
// The app's link checks the same again.
func shareable(addr ma.Multiaddr) bool {
	if relayed(addr) || manet.IsIPLoopback(addr) || manet.IsIP6LinkLocal(addr) || manet.IsIPUnspecified(addr) {
		return false
	}
	ip, err := manet.ToIP(addr)
	if err != nil || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.Equal(net.IPv4bcast) {
		return false
	}
	if v4 := ip.To4(); v4 != nil && v4[0] == 0 {
		return false
	}
	if ip.To4() == nil && slices.Equal(ip.To16()[:12], make([]byte, 12)) {
		return false
	}
	port := 0
	parts := strings.Split(addr.String(), "/")
	if len(parts) == 5 && parts[3] == "tcp" {
		port, _ = strconv.Atoi(parts[4])
	} else if len(parts) == 6 && parts[3] == "udp" && parts[5] == "quic-v1" {
		port, _ = strconv.Atoi(parts[4])
	}
	return port >= 1024 && port <= 65535
}

// allAddrs is every address this host knows for itself, including the
// router's mapping, before AutoNAT has confirmed any of them.
func (n *Node) allAddrs() []ma.Multiaddr {
	if all, ok := n.Host.(interface{ AllAddrs() []ma.Multiaddr }); ok {
		return all.AllAddrs()
	}
	return n.Host.Addrs()
}

// ShareAddrs are the addresses an invite lists for this computer: public
// ones first (a port the router opened, or a public IPv6 address), then
// the home network's, at most max in all.
func (n *Node) ShareAddrs(max int) (addrs []string, public bool) {
	if !n.Direct {
		return nil, false
	}
	var pub, home, other []string
	seen := map[string]bool{}
	preferred := outboundIPs()
	for _, a := range n.allAddrs() {
		s := a.String()
		if seen[s] || !shareable(a) {
			continue
		}
		seen[s] = true
		ip, _ := manet.ToIP(a)
		switch {
		case manet.IsPublicAddr(a):
			pub = append(pub, s)
		case slices.ContainsFunc(preferred, ip.Equal):
			home = append(home, s)
		default:
			// Another interface: a second network card, or a bridge for
			// containers or VMs that nobody else can reach. Last.
			other = append(other, s)
		}
	}
	slices.Sort(pub)
	slices.Sort(home)
	slices.Sort(other)
	addrs = append(append(pub, home...), other...)
	if len(addrs) > max {
		addrs = addrs[:max]
	}
	return addrs, len(pub) > 0
}

// WaitForPublic gives the router up to within to open a port, returning
// early once this computer has a public address.
func (n *Node) WaitForPublic(ctx context.Context, within time.Duration) {
	waitFor(ctx, within, func() bool {
		_, public := n.ShareAddrs(6)
		return public
	})
}

// ParseHostAddrs reads the addresses an invite listed for the host, with the
// same rules as ShareAddrs. Anything else is an error: the app checked them
// already, so one that fails here means something is wrong.
func ParseHostAddrs(raw []string) ([]ma.Multiaddr, error) {
	if len(raw) > 6 {
		return nil, errors.New("too many host addresses")
	}
	out := make([]ma.Multiaddr, 0, len(raw))
	for _, s := range raw {
		a, err := ma.NewMultiaddr(s)
		if err != nil || !shareable(a) || a.String() != s {
			return nil, fmt.Errorf("host address %q", s)
		}
		out = append(out, a)
	}
	return out, nil
}

// outboundIPs are the addresses this computer uses for the internet: the
// source the system picks for its default route, for IPv4 and IPv6. A UDP
// "dial" only asks the routing table; nothing is sent.
func outboundIPs() []net.IP {
	var out []net.IP
	for _, target := range []string{"192.0.2.1:9", "[2001:db8::1]:9"} {
		c, err := net.Dial("udp", target)
		if err != nil {
			continue
		}
		if a, ok := c.LocalAddr().(*net.UDPAddr); ok && !a.IP.IsUnspecified() {
			out = append(out, a.IP)
		}
		_ = c.Close()
	}
	return out
}
