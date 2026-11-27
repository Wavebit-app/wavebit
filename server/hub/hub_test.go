package hub

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A device that stops reading is dropped, and nobody waits for it.
func TestASlowReaderIsDroppedWithoutStallingAnyone(t *testing.T) {
	h := NewHub(Options{QueueFrames: 4, WriteTimeout: time.Second, PingInterval: time.Minute})
	attached := make(chan *Client, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		attached <- h.Attach("ROOM01", "slow", conn, nil)
	}))
	defer srv.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	c := <-attached

	// Far more than any socket buffer holds, so the writer does block.
	big := map[string]string{"x": strings.Repeat("a", 256<<10)}
	var slowest time.Duration
	for i := 0; i < 200; i++ {
		start := time.Now()
		h.Broadcast("ROOM01", big, "")
		slowest = max(slowest, time.Since(start))
	}
	// A broadcast that waited on the network would take up to WriteTimeout.
	if slowest > 200*time.Millisecond {
		t.Fatalf("a broadcast waited on a slow reader for %v", slowest)
	}
	select {
	case <-c.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("a reader that never read was not dropped")
	}
}

// A frame count alone wouldn't bound memory, since a queue frame can be big.
func TestASocketsBacklogIsCappedInBytes(t *testing.T) {
	h := NewHub(Options{QueueFrames: 1000, QueueBytes: 1 << 20, WriteTimeout: time.Second, PingInterval: time.Minute})
	attached := make(chan *Client, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		attached <- h.Attach("ROOM02", "slow", conn, nil)
	}))
	defer srv.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	c := <-attached
	big := map[string]string{"x": strings.Repeat("a", 512<<10)}
	for i := 0; i < 100; i++ {
		h.Broadcast("ROOM02", big, "")
	}
	select {
	case <-c.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("a socket holding far more than its byte allowance was kept")
	}
	if c.pending.Load() > 1<<20+512<<10+64 {
		t.Fatalf("pending bytes went past the cap: %d", c.pending.Load())
	}
}
