// Package hub holds the open sockets of every party and gets frames to them.
//
// Every socket has its own queue and its own writer. Sending never waits on the
// network: a frame is encoded once and dropped into each queue, and a device
// whose queue is full has fallen too far behind and is disconnected, so one
// device that stops reading never slows anyone else down.
package hub

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Options are the timings a hub's sockets run on.
type Options struct {
	// QueueFrames is how many frames may wait for one socket, and
	// QueueBytes how many bytes: a queue frame can be large, so a count
	// alone wouldn't bound the memory a socket that stopped reading holds.
	QueueFrames int
	QueueBytes  int64
	// WriteTimeout bounds one write to one socket.
	WriteTimeout time.Duration
	// PingInterval is how often the server pings; a socket that sends nothing
	// (not even the answer to a ping) for PongWait is closed.
	PingInterval time.Duration
	PongWait     time.Duration
}

// Client is one open socket.
type Client struct {
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	once      sync.Once
	drain     chan struct{}
	drainOnce sync.Once
	opts      Options
	extra     map[string]bool
	// pending is the bytes queued and not yet written.
	pending atomic.Int64
}

// Wants reports whether this socket's app declared feature when it joined.
func (c *Client) Wants(feature string) bool { return c.extra[feature] }

// Enqueue hands c a frame without waiting. It reports false, and closes c,
// when c is too far behind to take it.
func (c *Client) Enqueue(frame []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	size := int64(len(frame))
	if c.pending.Add(size) > c.opts.QueueBytes {
		c.pending.Add(-size)
		c.Close()
		return false
	}
	select {
	case c.send <- frame:
		return true
	default:
		c.pending.Add(-size)
		c.Close()
		return false
	}
}

// write sends one frame and gives its bytes back to the allowance.
func (c *Client) write(frame []byte) error {
	defer c.pending.Add(-int64(len(frame)))
	_ = c.conn.SetWriteDeadline(time.Now().Add(c.opts.WriteTimeout))
	return c.conn.WriteMessage(websocket.TextMessage, frame)
}

// SendJSON encodes v and enqueues it.
func (c *Client) SendJSON(v interface{}) bool {
	frame, err := json.Marshal(v)
	if err != nil {
		return false
	}
	return c.Enqueue(frame)
}

// Close ends the socket. Safe to call more than once and from anywhere.
func (c *Client) Close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

// CloseSoon closes the socket once what is already queued for it, such as a
// bye, has gone out.
func (c *Client) CloseSoon() {
	c.drainOnce.Do(func() { close(c.drain) })
}

// Done is closed once the socket is.
func (c *Client) Done() <-chan struct{} { return c.done }

// ExtendRead pushes the read deadline out by PongWait. Any frame from the
// device, or its answer to a ping, counts as a sign of life.
func (c *Client) ExtendRead() {
	_ = c.conn.SetReadDeadline(time.Now().Add(c.opts.PongWait))
}

func (c *Client) writer() {
	ping := time.NewTicker(c.opts.PingInterval)
	defer ping.Stop()
	defer c.Close()
	for {
		select {
		case <-c.done:
			return
		case frame := <-c.send:
			if err := c.write(frame); err != nil {
				return
			}
		case <-c.drain:
			for {
				select {
				case frame := <-c.send:
					if err := c.write(frame); err != nil {
						return
					}
				default:
					return
				}
			}
		case <-ping.C:
			deadline := time.Now().Add(c.opts.WriteTimeout)
			if err := c.conn.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
				return
			}
		}
	}
}

// Hub coordinates active WebSocket connections across rooms.
type Hub struct {
	mu      sync.RWMutex
	opts    Options
	sockets map[string]map[string]*Client // code -> memberId -> Client
}

func NewHub(opts Options) *Hub {
	if opts.QueueFrames <= 0 {
		opts.QueueFrames = 64
	}
	if opts.QueueBytes <= 0 {
		opts.QueueBytes = 2 << 20
	}
	if opts.WriteTimeout <= 0 {
		opts.WriteTimeout = 10 * time.Second
	}
	if opts.PingInterval <= 0 {
		opts.PingInterval = 30 * time.Second
	}
	if opts.PongWait <= opts.PingInterval {
		opts.PongWait = opts.PingInterval * 5 / 2
	}
	return &Hub{opts: opts, sockets: make(map[string]map[string]*Client)}
}

// Attach starts serving conn as memberId's socket in party code. A socket
// the member already had is closed: one member, one socket.
func (h *Hub) Attach(code, memberId string, conn *websocket.Conn, features []string) *Client {
	c := &Client{
		conn:  conn,
		send:  make(chan []byte, h.opts.QueueFrames),
		done:  make(chan struct{}),
		drain: make(chan struct{}),
		opts:  h.opts,
		extra: make(map[string]bool, len(features)),
	}
	for _, f := range features {
		c.extra[f] = true
	}
	conn.SetPongHandler(func(string) error {
		c.ExtendRead()
		return nil
	})
	c.ExtendRead()

	h.mu.Lock()
	room, ok := h.sockets[code]
	if !ok {
		room = make(map[string]*Client)
		h.sockets[code] = room
	}
	prev := room[memberId]
	room[memberId] = c
	h.mu.Unlock()

	if prev != nil {
		prev.Close()
	}
	go c.writer()
	return c
}

// Detach forgets c. It reports whether c was still the member's current
// socket: when a newer one replaced it, the member is still connected.
func (h *Hub) Detach(code, memberId string, c *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.sockets[code]
	if !ok {
		return false
	}
	current := room[memberId] == c
	if current {
		delete(room, memberId)
	}
	if len(room) == 0 {
		delete(h.sockets, code)
	}
	return current
}

func (h *Hub) DropParty(code string) {
	h.mu.Lock()
	room := h.sockets[code]
	delete(h.sockets, code)
	h.mu.Unlock()
	for _, c := range room {
		c.Close()
	}
}

func (h *Hub) MembersOnline(code string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.sockets[code]
	members := make([]string, 0, len(room))
	for mid := range room {
		members = append(members, mid)
	}
	return members
}

func (h *Hub) ActiveCodes() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	codes := make([]string, 0, len(h.sockets))
	for c := range h.sockets {
		codes = append(codes, c)
	}
	return codes
}

func (h *Hub) client(code, memberId string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.sockets[code][memberId]
}

// Send queues payload for one member.
func (h *Hub) Send(code, memberId string, payload interface{}) {
	if c := h.client(code, memberId); c != nil {
		c.SendJSON(payload)
	}
}

// CloseMember closes the member's socket once what is already queued for it
// has gone out.
func (h *Hub) CloseMember(code, memberId string) {
	if c := h.client(code, memberId); c != nil {
		c.CloseSoon()
	}
}

// Broadcast queues payload for everyone in the party except skipMemberId.
// It never waits on a network write, so it is safe under the party lock.
func (h *Hub) Broadcast(code string, payload interface{}, skipMemberId string) {
	h.BroadcastTo(code, payload, skipMemberId, "")
}

// BroadcastTo is Broadcast limited to sockets whose app declared feature;
// an empty feature means everyone.
func (h *Hub) BroadcastTo(code string, payload interface{}, skipMemberId, feature string) {
	frame, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.RLock()
	room := h.sockets[code]
	targets := make([]*Client, 0, len(room))
	for mid, c := range room {
		if mid != skipMemberId && (feature == "" || c.extra[feature]) {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.Enqueue(frame)
	}
}
