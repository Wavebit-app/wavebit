// Command wavebit-p2p is the helper behind "Host on this device". wavebit
// starts it, sends one line of JSON on stdin and reads JSON lines from
// stdout. Secrets come on stdin, never on the command line, where any process
// on the computer could read them. It exits when stdin closes, so it can't
// outlive the app.
//
// Host:  {"mode":"host","bridgeKey":"…","partyKey":"…","relay":"/dns4/…/p2p/…","direct":true}
// Join:  {"mode":"join","bridgeKey":"…","partyKey":"…","hostPeer":"12D3…","relay":"…","direct":true}
//
// Out:   {"event":"ready","port":43121,"peerId":"12D3…"}
// Out:   {"event":"links","direct":1,"relayed":0}
// Out:   {"event":"error","code":"relay_unreachable"}
package main

import (
	"bufio"
	"context"
	"encoding/json"
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
	Mode      string `json:"mode"`
	BridgeKey string `json:"bridgeKey"`
	PartyKey  string `json:"partyKey"`
	HostPeer  string `json:"hostPeer"`
	Relay     string `json:"relay"`
	Direct    bool   `json:"direct"`
}

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

	node, err := p2p.NewNode(p2p.NodeOptions{Relay: s.Relay, Direct: s.Direct})
	if err != nil {
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
		handler = party.Handler()
	case "join":
		hostID, err := peer.Decode(s.HostPeer)
		if err != nil {
			fail("bad_invite")
		}
		if err := node.ConnectHost(ctx, hostID); err != nil {
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

	say(map[string]interface{}{
		"event":  "ready",
		"port":   listener.Addr().(*net.TCPAddr).Port,
		"peerId": node.Host.ID().String(),
	})

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
		}
	}
}
