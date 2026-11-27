// Command wavebit-p2p is the helper behind "Host on this device". wavebit
// starts it, sends one line of JSON on stdin and reads JSON lines from
// stdout. Secrets come on stdin, never on the command line, where any process
// on the computer could read them. It exits when stdin closes, so it can't
// outlive the app.
//
// Host:  {"mode":"host","bridgeKey":"…","partyKey":"…","relay":"/dns4/…/p2p/…","direct":true}
// Join:  {"mode":"join","bridgeKey":"…","partyKey":"…","hostPeer":"12D3…","relay":"…","addrs":["/ip4/…/tcp/…"],"direct":true}
//
// The relay may be empty. A host then lists the addresses it can be reached
// at (its home network's, and a port its router opened when the router
// allows it), and a joiner dials those straight.
//
// Out:   {"event":"ready","port":43121,"peerId":"12D3…","addrs":["/ip4/…"],"public":true}
// Out:   {"event":"addrs","addrs":["/ip4/…"],"public":true}
// Out:   {"event":"links","direct":1,"relayed":0}
// Out:   {"event":"error","code":"relay_unreachable"}
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"

	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/listen"
	"github.com/Wavebit-app/wavebit/server/p2p"
)

type settings struct {
	Mode      string   `json:"mode"`
	BridgeKey string   `json:"bridgeKey"`
	PartyKey  string   `json:"partyKey"`
	HostPeer  string   `json:"hostPeer"`
	Relay     string   `json:"relay"`
	Addrs     []string `json:"addrs"`
	Direct    bool     `json:"direct"`
}

// maxAddrs is how many addresses an invite lists for the host.
const maxAddrs = 6

var (
	keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22,64}$`)
	out        = json.NewEncoder(os.Stdout)
	outMu      sync.Mutex
)

func say(v map[string]interface{}) {
	outMu.Lock()
	defer outMu.Unlock()
	_ = out.Encode(v)
}

func fail(code string) {
	say(map[string]interface{}{"event": "error", "code": code})
	os.Exit(1)
}

func main() {
	in := bufio.NewReader(io.LimitReader(os.Stdin, 4096))
	line, err := in.ReadBytes('\n')
	if err != nil {
		fail("bad_settings")
	}
	var s settings
	if json.Unmarshal(line, &s) != nil ||
		(s.Mode != "host" && s.Mode != "join") ||
		!keyPattern.MatchString(s.BridgeKey) ||
		!keyPattern.MatchString(s.PartyKey) {
		fail("bad_settings")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// The app closing stdin, or going away, ends the helper.
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		cancel()
	}()

	// A guest's helper only ever talks to the host (and the relay).
	var only peer.ID
	if s.Mode == "join" {
		if only, err = peer.Decode(s.HostPeer); err != nil {
			fail("bad_invite")
		}
	}
	node, err := p2p.NewNode(p2p.NodeOptions{
		Relay:    s.Relay,
		Direct:   s.Direct,
		MapPort:  s.Mode == "host",
		OnlyPeer: only,
	})
	if errors.Is(err, p2p.ErrNoPath) {
		fail("no_relay")
	} else if err != nil {
		fail("bad_relay")
	}
	defer node.Close()

	var handler http.Handler
	switch s.Mode {
	case "host":
		// One party, made by this computer's own app through the bridge.
		config.MaxParties = 1
		config.MaxPartiesPerClient = 0
		config.CreateRatePerMinute = 30
		config.MaxMembers = 10
		party := listen.New()
		party.Service = "wavebit-listen-together-p2p"
		go party.Run(ctx.Done())
		stop := p2p.ServeParty(node, s.PartyKey, party.Handler())
		defer stop()
		if node.HasRelay() {
			ready := make(chan error, 1)
			go node.KeepReservation(ctx, func(err error) { ready <- err })
			select {
			case err := <-ready:
				if err != nil {
					fail("relay_unreachable")
				}
			case <-ctx.Done():
				return
			}
		} else {
			// No relay: give the router a moment to open a port, so the
			// invite can list an address friends elsewhere can reach.
			node.WaitForPublic(ctx, 5*time.Second)
		}
		handler = party.Handler()
	case "join":
		hostID := only
		addrs, err := p2p.ParseHostAddrs(s.Addrs)
		if err != nil {
			fail("bad_invite")
		}
		if err := node.ConnectHost(ctx, hostID, addrs); err != nil {
			fail("host_unreachable")
		}
		// Same network or same machine: straight there. Otherwise hole
		// punching, started by the host, may still open a direct path.
		go node.TryLocal(ctx, hostID)
		handler = p2p.Proxy(node, hostID, s.PartyKey)
	}

	if s.Direct {
		go node.MoveOffRelay(ctx)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fail("bridge_failed")
	}
	bridge := p2p.Bridge(s.BridgeKey, listener, handler)
	go func() { _ = bridge.Serve(listener) }()
	defer bridge.Close()

	shared := func() (map[string]interface{}, string) {
		addrs, public := []string{}, false
		if s.Mode == "host" {
			addrs, public = node.ShareAddrs(maxAddrs)
			if addrs == nil {
				addrs = []string{}
			}
		}
		return map[string]interface{}{"addrs": addrs, "public": public}, fmt.Sprint(addrs)
	}
	ready, lastAddrs := shared()
	ready["event"] = "ready"
	ready["port"] = listener.Addr().(*net.TCPAddr).Port
	ready["peerId"] = node.Host.ID().String()
	say(ready)

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	last := ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			direct, relayed := node.Links()
			now := fmt.Sprint(direct, relayed)
			if now != last {
				last = now
				say(map[string]interface{}{"event": "links", "direct": direct, "relayed": relayed})
			}
			// A router can open its port late, and a laptop can change
			// networks: the invite follows.
			if now, key := shared(); key != lastAddrs {
				lastAddrs = key
				now["event"] = "addrs"
				say(now)
			}
		}
	}
}
