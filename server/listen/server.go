// Package listen is the party server: REST to make and end memberships, one
// WebSocket per device for everything else. It started as BitChord's
// backend/main.go (see NOTICE.md); the protocol is unchanged, so BitChord's
// apps and wavebit can share a party on it.
package listen

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/hub"
	"github.com/Wavebit-app/wavebit/server/party"
)

// Server holds the parties, their sockets and the limits.
type Server struct {
	store         *party.PartyStore
	hub           *hub.Hub
	createLimiter *ipRateLimiter
	lookupLimiter *ipRateLimiter
	missLimiter   *ipRateLimiter
	networkMisses *ipRateLimiter
	globalMisses  *bucket
	upgrader      websocket.Upgrader
	// Service names the server on GET /.
	Service string
}

// New makes a server from the config package's current values.
func New() *Server {
	s := &Server{
		store: party.NewPartyStore(),
		hub: hub.NewHub(hub.Options{
			QueueFrames:  config.SendQueueFrames,
			QueueBytes:   config.SendQueueBytes,
			WriteTimeout: 10 * time.Second,
			PingInterval: time.Duration(config.PingIntervalMs) * time.Millisecond,
			PongWait:     time.Duration(config.PongWaitMs) * time.Millisecond,
		}),
		createLimiter: newIPRateLimiter(time.Minute, config.CreateRatePerMinute, config.RateLimitMaxEntries),
		lookupLimiter: newIPRateLimiter(time.Minute, config.LookupRatePerMinute, config.RateLimitMaxEntries),
		missLimiter:   newIPRateLimiter(time.Minute, config.MissRatePerMinute, config.RateLimitMaxEntries),
		networkMisses: newIPRateLimiter(time.Minute, config.MissRatePerNetworkMinute, config.RateLimitMaxEntries),
		globalMisses:  newBucket(config.GlobalMissRatePerMinute),
		Service:       "wavebit-listen-together",
	}
	s.upgrader = websocket.Upgrader{
		// Answered only to a browser that offered it with its token (see
		// parseSocketToken); a native client offers no subprotocol and gets none.
		Subprotocols: []string{socketProtocol},
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			return origin == "" || config.IsAllowedOrigin(origin)
		},
	}
	return s
}

// Handler is every route, behind the CORS and header rules.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleRoot)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/time", s.handleTime)
	mux.HandleFunc("POST /api/parties", s.handleCreateParty)
	mux.HandleFunc("POST /api/parties/{code}/join", s.handleJoinParty)
	mux.HandleFunc("GET /api/parties/{code}", s.handleGetParty)
	mux.HandleFunc("GET /api/parties/{code}/preview", s.handlePreviewParty)
	mux.HandleFunc("POST /api/parties/{code}/leave", s.handleLeaveParty)
	mux.HandleFunc("GET /invite/{code}", s.handleInviteLanding)
	mux.HandleFunc("GET /ws/parties/{code}", s.handleWebSocket)
	return corsMiddleware(mux)
}

// Run restates every party's state and sweeps finished ones until stop closes.
func (s *Server) Run(stop <-chan struct{}) {
	interval := time.Duration(config.StateHeartbeatMs) * time.Millisecond
	if interval < time.Second {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.heartbeat()
		}
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Always, so a cache never hands one origin's answer to another.
		w.Header().Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if origin != "" && config.IsAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == "OPTIONS" {
			if origin != "" && !config.IsAllowedOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, config.RequestMaxBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			jsonError(w, http.StatusRequestEntityTooLarge, "request_too_large", "Request body is too large.")
		} else {
			jsonError(w, http.StatusUnprocessableEntity, "invalid_json", "Malformed JSON body.")
		}
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		jsonError(w, http.StatusUnprocessableEntity, "invalid_json", "Request body must contain one JSON object.")
		return false
	}
	return true
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, errCode, msg string) {
	jsonResponse(w, status, map[string]string{
		"error":   errCode,
		"message": msg,
	})
}

// partyError answers with a party.PartyError's own status and code.
func partyError(w http.ResponseWriter, err error, fallbackStatus int, fallbackCode, fallbackMsg string) {
	var pe *party.PartyError
	if errors.As(err, &pe) {
		jsonError(w, pe.Status, pe.Code, pe.Message)
		return
	}
	jsonError(w, fallbackStatus, fallbackCode, fallbackMsg)
}

func parseBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

// Browsers cannot set headers on a WebSocket handshake, so the web player
// offers its token as a subprotocol instead: "bitchord.v1, bitchord.token.<hex>".
// It still stays out of the URL, and so out of access logs, which is the reason
// the header was chosen; the server answers with "bitchord.v1" alone and never
// echoes the token.
const (
	socketProtocol    = "bitchord.v1"
	socketTokenPrefix = "bitchord.token."
)

// parseSocketToken reads the party token from the Authorization header (the
// apps) or from an offered subprotocol (browsers).
func parseSocketToken(r *http.Request) string {
	if token := parseBearerToken(r); token != "" {
		return token
	}
	for _, protocol := range websocket.Subprotocols(r) {
		if strings.HasPrefix(protocol, socketTokenPrefix) {
			return strings.TrimPrefix(protocol, socketTokenPrefix)
		}
	}
	return ""
}

func tooMany(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "60")
	jsonError(w, http.StatusTooManyRequests, "rate_limited", "Too many tries. Wait a minute and try again.")
}

func noParty(w http.ResponseWriter) {
	jsonError(w, http.StatusNotFound, "no_such_party", "No party with that code.")
}

// guessing reports whether this address, its network, or everyone together
// has used up the allowance for wrong codes.
func (s *Server) guessing(r *http.Request) bool {
	wide := requestNetworkKey(r)
	return s.missLimiter.Exceeded(requestKey(r)) ||
		(wide != "" && s.networkMisses.Exceeded(wide)) ||
		s.globalMisses.Empty()
}

// missed counts a wrong code.
func (s *Server) missed(r *http.Request) {
	s.missLimiter.Allow(requestKey(r))
	if wide := requestNetworkKey(r); wide != "" {
		s.networkMisses.Allow(wide)
	}
	s.globalMisses.Spend()
}

// lookup finds the party a request without a token names (join, preview):
// the requests a guesser would make. Wrong codes count against a much
// smaller allowance than lookups do, per address, per network and for
// everyone, and every miss reads the same. It writes the refusal itself.
func (s *Server) lookup(w http.ResponseWriter, r *http.Request) *party.Party {
	if !s.lookupLimiter.Allow(requestKey(r)) || s.guessing(r) {
		tooMany(w)
		return nil
	}
	p := s.store.Find(r.PathValue("code"))
	if p == nil {
		s.missed(r)
		noParty(w)
	}
	return p
}

// member finds the party and the member a token belongs to. Tokens are 192
// random bits, so nobody guesses one, and a wrong code and a wrong token read
// the same: this path tells a guesser nothing and isn't counted as guessing.
// That is what keeps members reconnecting while guessers elsewhere have used
// up the allowance for wrong codes.
func (s *Server) member(w http.ResponseWriter, r *http.Request, token string) (*party.Party, *party.Member) {
	if !s.lookupLimiter.Allow(requestKey(r)) {
		tooMany(w)
		return nil, nil
	}
	p := s.store.Find(r.PathValue("code"))
	if p == nil {
		noParty(w)
		return nil, nil
	}
	p.Lock()
	m, err := p.Authenticate(token)
	p.Unlock()
	if err != nil {
		noParty(w)
		return nil, nil
	}
	return p, m
}
