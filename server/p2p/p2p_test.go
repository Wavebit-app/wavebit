package p2p

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	relay "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"

	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/listen"
)

const (
	bridgeKey = "bridge-secret-0123456789abcdef"
	partyKey  = "party-key-0123456789abcdefgh"
)

// startRelay runs a relay on loopback, as wavebit-relay does.
func startRelay(t *testing.T) string {
	t.Helper()
	res := relay.DefaultResources()
	res.Limit = &relay.RelayLimit{Duration: 30 * time.Minute, Data: 32 << 20}
	h, err := libp2p.New(
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.EnableRelayService(relay.WithResources(res)),
		libp2p.ForceReachabilityPublic(),
		libp2p.DisableMetrics(),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Close() })
	return fmt.Sprintf("%s/p2p/%s", h.Addrs()[0], h.ID())
}

func serveBridge(t *testing.T, handler http.Handler) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	b := Bridge(bridgeKey, l, handler)
	go func() { _ = b.Serve(l) }()
	t.Cleanup(func() { b.Close() })
	return "http://" + l.Addr().String()
}

func call(t *testing.T, method, url string, body interface{}, headers map[string]string) (int, map[string]interface{}) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, url, reader)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	var out map[string]interface{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// A party on the host's computer, joined from another through the relay,
// both sides using nothing but their own bridges, as the app does.
func TestAPartyOverTheRelay(t *testing.T) {
	config.MaxParties = 1
	config.MaxPartiesPerClient = 0
	t.Cleanup(func() { config.MaxParties = 50; config.MaxPartiesPerClient = 3 })
	relayAddr := startRelay(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	// Direct connections off: everything goes through the relay, as on two
	// networks that can't punch through.
	host, err := NewNode(NodeOptions{Relay: relayAddr, Direct: false})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { host.Close() })
	party := listen.New()
	stop := ServeParty(host, partyKey, party.Handler())
	t.Cleanup(stop)
	ready := make(chan error, 1)
	go host.KeepReservation(ctx, func(err error) { ready <- err })
	if err := <-ready; err != nil {
		t.Fatalf("reservation: %v", err)
	}
	hostBridge := serveBridge(t, party.Handler())

	guest, err := NewNode(NodeOptions{Relay: relayAddr, Direct: false})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { guest.Close() })
	if err := guest.ConnectHost(ctx, host.Host.ID(), nil); err != nil {
		t.Fatalf("connect to host: %v", err)
	}
	guestBridge := serveBridge(t, Proxy(guest, host.Host.ID(), partyKey))
	auth := map[string]string{BridgeHeader: bridgeKey}

	status, made := call(t, "POST", hostBridge+"/api/parties",
		map[string]string{"userId": "u1", "deviceId": "d1", "displayName": "Asha"}, auth)
	if status != http.StatusCreated {
		t.Fatalf("create on the host: %d %v", status, made)
	}
	code := made["code"].(string)

	status, joined := call(t, "POST", guestBridge+"/api/parties/"+code+"/join",
		map[string]string{"userId": "u2", "deviceId": "d2", "displayName": "Maya"}, auth)
	if status != http.StatusOK {
		t.Fatalf("join through the relay: %d %v", status, joined)
	}

	// The socket, through the proxy and the relay.
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	h := http.Header{}
	h.Set(BridgeHeader, bridgeKey)
	h.Set("Authorization", "Bearer "+joined["token"].(string))
	ws, _, err := dialer.Dial("ws"+guestBridge[len("http"):]+"/ws/parties/"+code, h)
	if err != nil {
		t.Fatalf("socket through the relay: %v", err)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	var welcome map[string]interface{}
	if err := ws.ReadJSON(&welcome); err != nil || welcome["type"] != "welcome" {
		t.Fatalf("welcome: %v %v", welcome, err)
	}

	// Making a party from the guest's side is refused: only the host makes one.
	if status, _ := call(t, "POST", guestBridge+"/api/parties",
		map[string]string{"userId": "u3", "deviceId": "d3", "displayName": "X"}, auth); status != http.StatusForbidden {
		t.Fatalf("a guest made a party on the host: %d", status)
	}

	if direct, relayed := guest.Links(); direct != 0 || relayed != 1 {
		t.Fatalf("with direct connections off the link should be relayed, got %d direct %d relayed", direct, relayed)
	}
}

func TestAWrongKeyIsRefusedAndCounted(t *testing.T) {
	relayAddr := startRelay(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	host, _ := NewNode(NodeOptions{Relay: relayAddr})
	t.Cleanup(func() { host.Close() })
	stop := ServeParty(host, partyKey, listen.New().Handler())
	t.Cleanup(stop)
	ready := make(chan error, 1)
	go host.KeepReservation(ctx, func(err error) { ready <- err })
	if err := <-ready; err != nil {
		t.Fatal(err)
	}
	guest, _ := NewNode(NodeOptions{Relay: relayAddr})
	t.Cleanup(func() { guest.Close() })
	if err := guest.ConnectHost(ctx, host.Host.ID(), nil); err != nil {
		t.Fatal(err)
	}
	bridge := serveBridge(t, Proxy(guest, host.Host.ID(), "the-wrong-key-0123456789ab"))
	auth := map[string]string{BridgeHeader: bridgeKey}
	for i := 0; i < maxBadPerPeer; i++ {
		if status, _ := call(t, "GET", bridge+"/api/time", nil, auth); status != http.StatusNotFound {
			t.Fatalf("wrong key %d: %d", i, status)
		}
	}
	// After that many, the host stops taking this peer's streams at all.
	if status, _ := call(t, "GET", bridge+"/api/time", nil, auth); status != http.StatusBadGateway {
		t.Fatalf("a peer with too many wrong keys was still served: %d", status)
	}
}

func TestTheBridgeOnlyAnswersItsOwnApp(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(BridgeHeader) != "" {
			t.Error("the bridge secret was passed on")
		}
		w.WriteHeader(http.StatusTeapot)
	})
	base := serveBridge(t, ok)
	cases := []struct {
		name    string
		headers map[string]string
		host    string
		want    int
	}{
		{"its own app", map[string]string{BridgeHeader: bridgeKey}, "", http.StatusTeapot},
		{"no secret", nil, "", http.StatusForbidden},
		{"a wrong secret", map[string]string{BridgeHeader: "nope"}, "", http.StatusForbidden},
		{"a web page", map[string]string{BridgeHeader: bridgeKey, "Origin": "https://evil.example"}, "", http.StatusForbidden},
		{"a fetch from a page", map[string]string{BridgeHeader: bridgeKey, "Sec-Fetch-Site": "cross-site"}, "", http.StatusForbidden},
		{"DNS rebinding", map[string]string{BridgeHeader: bridgeKey}, "evil.example:80", http.StatusForbidden},
	}
	for _, c := range cases {
		req, _ := http.NewRequest("GET", base+"/api/time", nil)
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		if c.host != "" {
			req.Host = c.host
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != c.want {
			t.Errorf("%s: got %d, want %d", c.name, res.StatusCode, c.want)
		}
	}
}

func TestRelayAddressesMustNameThePeer(t *testing.T) {
	if _, err := ParseRelay("/ip4/1.2.3.4/tcp/4001"); err == nil {
		t.Fatal("a relay without /p2p/ was accepted")
	}
	if _, err := ParseRelay("not an address"); err == nil {
		t.Fatal("junk accepted")
	}
}

// With direct connections allowed, two computers that can reach each other
// end up connected directly, and the party moves off the relay: its socket on
// the relayed path closes and a new one runs directly.
func TestTheLinkMovesOffTheRelayWhenADirectOneOpens(t *testing.T) {
	config.MaxParties, config.MaxPartiesPerClient = 1, 0
	t.Cleanup(func() { config.MaxParties = 50; config.MaxPartiesPerClient = 3 })
	relayAddr := startRelay(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	host, err := NewNode(NodeOptions{Relay: relayAddr, Direct: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { host.Close() })
	party := listen.New()
	t.Cleanup(ServeParty(host, partyKey, party.Handler()))
	ready := make(chan error, 1)
	go host.KeepReservation(ctx, func(err error) { ready <- err })
	if err := <-ready; err != nil {
		t.Fatal(err)
	}
	hostBridge := serveBridge(t, party.Handler())
	auth := map[string]string{BridgeHeader: bridgeKey}
	_, made := call(t, "POST", hostBridge+"/api/parties",
		map[string]string{"userId": "u1", "deviceId": "d1", "displayName": "Asha"}, auth)
	code := made["code"].(string)

	guest, err := NewNode(NodeOptions{Relay: relayAddr, Direct: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { guest.Close() })
	if err := guest.ConnectHost(ctx, host.Host.ID(), nil); err != nil {
		t.Fatal(err)
	}
	guestBridge := serveBridge(t, Proxy(guest, host.Host.ID(), partyKey))
	_, joined := call(t, "POST", guestBridge+"/api/parties/"+code+"/join",
		map[string]string{"userId": "u2", "deviceId": "d2", "displayName": "Maya"}, auth)
	dial := func() *websocket.Conn {
		h := http.Header{}
		h.Set(BridgeHeader, bridgeKey)
		h.Set("Authorization", "Bearer "+joined["token"].(string))
		ws, _, err := (&websocket.Dialer{HandshakeTimeout: 10 * time.Second}).Dial("ws"+guestBridge[len("http"):]+"/ws/parties/"+code, h)
		if err != nil {
			t.Fatalf("socket: %v", err)
		}
		return ws
	}
	first := dial()
	defer first.Close()

	if !guest.TryLocal(ctx, host.Host.ID()) {
		t.Fatal("no direct connection between two computers that can reach each other")
	}
	go guest.MoveOffRelay(ctx)

	// The socket on the relayed connection ends…
	_ = first.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		if _, _, err := first.ReadMessage(); err != nil {
			break
		}
	}
	// …and the next one goes straight to the host.
	second := dial()
	defer second.Close()
	_ = second.SetReadDeadline(time.Now().Add(10 * time.Second))
	var welcome map[string]interface{}
	if err := second.ReadJSON(&welcome); err != nil || welcome["type"] != "welcome" {
		t.Fatalf("welcome on the direct path: %v %v", welcome, err)
	}
	if direct, relayed := guest.Links(); direct != 1 || relayed != 0 {
		t.Fatalf("expected the host direct and off the relay, got %d direct %d relayed", direct, relayed)
	}
}

func TestAStrangerCantPauseKnownMembers(t *testing.T) {
	g := newPeerGuard()
	member, stranger := peer.ID("member"), peer.ID("stranger")
	g.keyed(member)
	for i := 0; i <= maxBadGlobalMin; i++ {
		g.wrongKey(peer.ID(fmt.Sprint("fresh", i)))
	}
	if g.admit(stranger) {
		t.Fatal("the pause didn't hold new peers back")
	}
	if !g.admit(member) {
		t.Fatal("a member who showed the key was paused by strangers")
	}
}

func TestTheGuardForgetsIdlePeers(t *testing.T) {
	g := newPeerGuard()
	for i := 0; i < maxTracked*3; i++ {
		p := peer.ID(fmt.Sprint("p", i))
		if g.admit(p) {
			g.done(p)
		}
		g.recent[p] = []time.Time{time.Now().Add(-2 * time.Minute)}
	}
	if len(g.recent) > maxTracked+1 || len(g.open) != 0 {
		t.Fatalf("the guard kept %d peers and %d open counts", len(g.recent), len(g.open))
	}
}

// With no relay, a friend reaches the host's computer at the addresses its
// invite lists: here, this machine's own network address.
func TestAPartyWithNoRelay(t *testing.T) {
	config.MaxParties = 1
	config.MaxPartiesPerClient = 0
	t.Cleanup(func() { config.MaxParties = 50; config.MaxPartiesPerClient = 3 })
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	if _, err := NewNode(NodeOptions{Direct: false}); err != ErrNoPath {
		t.Fatalf("no relay and no direct connections should be refused, got %v", err)
	}
	host, err := NewNode(NodeOptions{Direct: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { host.Close() })
	shared, _ := host.ShareAddrs(6)
	if len(shared) == 0 {
		t.Skip("this machine has no network address besides loopback")
	}
	for _, a := range shared {
		if strings.Contains(a, "/127.") || strings.Contains(a, "/::1/") || strings.Contains(a, "p2p") {
			t.Fatalf("shared an address a link may not carry: %s", a)
		}
	}
	party := listen.New()
	stop := ServeParty(host, partyKey, party.Handler())
	t.Cleanup(stop)
	hostBridge := serveBridge(t, party.Handler())

	guest, err := NewNode(NodeOptions{Direct: true, OnlyPeer: host.Host.ID()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { guest.Close() })
	addrs, err := ParseHostAddrs(shared)
	if err != nil {
		t.Fatal(err)
	}
	if err := guest.ConnectHost(ctx, host.Host.ID(), addrs); err != nil {
		t.Fatalf("connect straight to the host: %v", err)
	}
	guestBridge := serveBridge(t, Proxy(guest, host.Host.ID(), partyKey))
	auth := map[string]string{BridgeHeader: bridgeKey}
	status, made := call(t, "POST", hostBridge+"/api/parties",
		map[string]string{"userId": "u1", "deviceId": "d1", "displayName": "Asha"}, auth)
	if status != http.StatusCreated {
		t.Fatalf("create on the host: %d %v", status, made)
	}
	status, joined := call(t, "POST", guestBridge+"/api/parties/"+made["code"].(string)+"/join",
		map[string]string{"userId": "u2", "deviceId": "d2", "displayName": "Maya"}, auth)
	if status != http.StatusOK {
		t.Fatalf("join with no relay: %d %v", status, joined)
	}
	if direct, relayed := guest.Links(); direct != 1 || relayed != 0 {
		t.Fatalf("want one direct link, got %d direct %d relayed", direct, relayed)
	}

	// A guest's helper talks to the host only: a stranger who learns its
	// address is refused.
	stranger, err := NewNode(NodeOptions{Direct: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stranger.Close() })
	dial, stop2 := context.WithTimeout(ctx, 5*time.Second)
	defer stop2()
	// The stranger's side may finish its handshake before the guest's refusal
	// reaches it, so look from the guest's side.
	_ = stranger.Host.Connect(dial, peer.AddrInfo{ID: guest.Host.ID(), Addrs: guest.Host.Addrs()})
	time.Sleep(300 * time.Millisecond)
	if guest.Host.Network().Connectedness(stranger.Host.ID()) == network.Connected {
		t.Fatal("a guest's helper accepted a stranger")
	}
	if _, err := stranger.Host.NewStream(dial, guest.Host.ID(), ProtocolID); err == nil {
		t.Fatal("a stranger opened a stream to a guest's helper")
	}
}

func TestHostAddressesFromALinkAreChecked(t *testing.T) {
	for _, bad := range []string{
		"/ip4/127.0.0.1/tcp/40211",
		"/ip4/0.0.0.0/tcp/40211",
		"/ip4/169.254.3.4/tcp/40211",
		"/ip4/192.168.1.2/tcp/22",
		"/ip4/192.168.1.2/udp/40211",
		"/ip6/::1/tcp/40211",
		"/ip6/fe80::1/tcp/40211",
		"/dns4/example.com/tcp/40211",
		"/ip4/192.168.1.2/tcp/40211/p2p/12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz",
	} {
		if _, err := ParseHostAddrs([]string{bad}); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
	if _, err := ParseHostAddrs([]string{"/ip4/192.168.1.2/tcp/40211", "/ip6/2001:db8::5/udp/40211/quic-v1"}); err != nil {
		t.Fatal(err)
	}
}
