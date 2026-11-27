// Package p2p carries the party protocol between computers over libp2p, for
// "Host on this device": the host's computer runs the party server itself,
// and friends reach it directly when their routers allow, through wavebit's
// relay when they don't. The app never speaks libp2p: on each computer this
// helper serves a bridge on 127.0.0.1, and the app's ordinary party client
// connects to that as if it were a server.
package p2p

import (
	"context"
	"errors"
	"net"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// streamConn lets HTTP, and the WebSocket upgrade, run over one stream.
type streamConn struct {
	network.Stream
}

type peerAddr struct{ id peer.ID }

func (a peerAddr) Network() string { return "libp2p" }

// String is the peer id: what the party server's limits see as the address.
func (a peerAddr) String() string { return a.id.String() }

func (c streamConn) LocalAddr() net.Addr  { return peerAddr{c.Conn().LocalPeer()} }
func (c streamConn) RemoteAddr() net.Addr { return peerAddr{c.Conn().RemotePeer()} }

// Close closes both directions; http.Server and the proxy expect a full close.
func (c streamConn) Close() error { return c.Stream.Close() }

// streamListener hands the streams a protocol handler receives to http.Serve.
type streamListener struct {
	addr   net.Addr
	conns  chan net.Conn
	done   chan struct{}
	once   sync.Once
	accept func(network.Stream) bool
	// release undoes accept for a stream that was never served.
	release func(network.Stream)
}

func newStreamListener(local peer.ID, accept func(network.Stream) bool) *streamListener {
	return &streamListener{
		addr:   peerAddr{local},
		conns:  make(chan net.Conn),
		done:   make(chan struct{}),
		accept: accept,
	}
}

// handle is the libp2p stream handler.
func (l *streamListener) handle(s network.Stream) {
	if l.accept != nil && !l.accept(s) {
		_ = s.Reset()
		return
	}
	select {
	case l.conns <- streamConn{s}:
	case <-l.done:
		l.refused(s)
	case <-time.After(10 * time.Second):
		l.refused(s)
	}
}

// refused resets a stream that was admitted but never served, and gives its
// place back.
func (l *streamListener) refused(s network.Stream) {
	_ = s.Reset()
	if l.release != nil {
		l.release(s)
	}
}

func (l *streamListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *streamListener) Close() error {
	l.once.Do(func() { close(l.done) })
	return nil
}

func (l *streamListener) Addr() net.Addr { return l.addr }

// dialer opens a stream to the host for the joiner's proxy. The relayed
// connection counts as limited, so it has to be allowed explicitly.
func dialer(n *Node, host peer.ID) func(ctx context.Context, _, _ string) (net.Conn, error) {
	return func(ctx context.Context, _, _ string) (net.Conn, error) {
		ctx = network.WithAllowLimitedConn(ctx, "wavebit party")
		s, err := n.Host.NewStream(ctx, host, ProtocolID)
		if err != nil {
			return nil, errors.Join(errHostUnreachable, err)
		}
		return streamConn{s}, nil
	}
}

var errHostUnreachable = errors.New("host unreachable")
