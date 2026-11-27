// Command wavebit-relay is the relay behind "Host on this device": it holds
// a slot for each host so friends can reach it, passes bytes it can't read
// (both ends encrypt), and helps the two sides open a direct connection.
// Public relays cut a connection after 2 minutes or 128 KiB, which is why
// wavebit runs its own.
//
//	WAVEBIT_RELAY_KEY_FILE   private key, made on first run (mode 0600)
//	WAVEBIT_RELAY_LISTEN     comma-separated multiaddrs (default tcp and quic on 4001)
//	WAVEBIT_RELAY_ANNOUNCE   comma-separated public multiaddrs, optional
package main

import (
	"crypto/rand"
	"errors"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	relay "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	libp2ptls "github.com/libp2p/go-libp2p/p2p/security/tls"
	quic "github.com/libp2p/go-libp2p/p2p/transport/quic"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ma "github.com/multiformats/go-multiaddr"
)

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func loadKey(path string) (crypto.PrivKey, error) {
	if data, err := os.ReadFile(path); err == nil {
		return crypto.UnmarshalPrivateKey(data)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	priv, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}
	data, err := crypto.MarshalPrivateKey(priv)
	if err != nil {
		return nil, err
	}
	return priv, os.WriteFile(path, data, 0o600)
}

func main() {
	priv, err := loadKey(env("WAVEBIT_RELAY_KEY_FILE", "relay.key"))
	if err != nil {
		log.Fatalf("relay key: %v", err)
	}
	listen := strings.Split(env("WAVEBIT_RELAY_LISTEN",
		"/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/udp/4001/quic-v1,/ip6/::/tcp/4001,/ip6/::/udp/4001/quic-v1"), ",")

	// A party is a few kilobytes every few seconds; these leave plenty of
	// room for that and none for using the relay as a general proxy.
	resources := relay.DefaultResources()
	resources.ReservationTTL = time.Hour
	resources.MaxReservations = 2048
	// Per peer, in and out: a host's friends each take one, and hosts close
	// peers that never show their invite's key, so idle strangers can't
	// hold them all.
	resources.MaxCircuits = 64
	resources.MaxReservationsPerIP = 8
	resources.MaxReservationsPerASN = 64
	resources.Limit = &relay.RelayLimit{Duration: 30 * time.Minute, Data: 32 << 20}

	limits := rcmgr.DefaultLimits
	libp2p.SetDefaultServiceLimits(&limits)
	rm, err := rcmgr.NewResourceManager(rcmgr.NewFixedLimiter(limits.AutoScale()))
	if err != nil {
		log.Fatal(err)
	}

	options := []libp2p.Option{
		libp2p.Identity(priv),
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Transport(quic.NewTransport),
		libp2p.Security(noise.ID, noise.New),
		libp2p.Security(libp2ptls.ID, libp2ptls.New),
		libp2p.ListenAddrStrings(listen...),
		libp2p.ResourceManager(rm),
		libp2p.EnableRelayService(relay.WithResources(resources)),
		libp2p.EnableNATService(),
		libp2p.EnableAutoNATv2(),
		libp2p.ForceReachabilityPublic(),
		libp2p.DisableMetrics(),
		libp2p.UserAgent("wavebit-relay"),
	}
	if announce := env("WAVEBIT_RELAY_ANNOUNCE", ""); announce != "" {
		var addrs []ma.Multiaddr
		for _, a := range strings.Split(announce, ",") {
			addr, err := ma.NewMultiaddr(strings.TrimSpace(a))
			if err != nil {
				log.Fatalf("announce %q: %v", a, err)
			}
			addrs = append(addrs, addr)
		}
		options = append(options, libp2p.AddrsFactory(func([]ma.Multiaddr) []ma.Multiaddr { return addrs }))
	}
	h, err := libp2p.New(options...)
	if err != nil {
		log.Fatal(err)
	}
	defer h.Close()

	log.Printf("wavebit relay %s", h.ID())
	for _, a := range h.Addrs() {
		log.Printf("  %s/p2p/%s", a, h.ID())
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals
}
