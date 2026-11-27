package listen

import (
	"net/http"
	"sort"

	"github.com/Wavebit-app/wavebit/server/clock"
	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/party"
	"github.com/Wavebit-app/wavebit/server/protocol"
)

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"service":  s.Service,
		"members":  s.store.MemberCount(),
		"parties":  s.store.Len(),
		"serverMs": clock.NowMs(),
		"features": protocol.Features,
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"ok":       true,
		"serverMs": clock.NowMs(),
	})
}

func (s *Server) handleTime(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"serverMs": clock.NowMs(),
	})
}

func membership(p *party.Party, m *party.Member) map[string]interface{} {
	return map[string]interface{}{
		"code":  p.Code,
		"token": m.Token,
		"you":   m.ToWire(),
		"party": p.ToWire(),
	}
}

func (s *Server) handleCreateParty(w http.ResponseWriter, r *http.Request) {
	key := requestKey(r)
	if !s.createLimiter.Allow(key) {
		jsonError(w, http.StatusTooManyRequests, "create_rate_limited", "You can create up to two parties per minute. Please try again shortly.")
		return
	}
	var req protocol.JoinRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := req.Validate(); err != nil {
		jsonError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}

	maxMembers := config.MaxMembers
	if req.MaxMembers != nil {
		maxMembers = *req.MaxMembers
	}
	p, err := s.store.CreateFor(key, requestNetworkKey(r), config.MaxParties, maxMembers)
	if err != nil {
		partyError(w, err, http.StatusInternalServerError, "server_error", "Failed to create party.")
		return
	}

	p.Lock()
	// This must be present in the creation response. Waiting for the first
	// WebSocket control can lose the setting before that socket is established.
	if req.AutoplayEnabled != nil {
		p.Playback.AutoplayEnabled = *req.AutoplayEnabled
	}
	m, err := p.Join(req.UserId, req.DeviceId, req.DisplayName, req.AvatarUrl)
	if err != nil {
		p.Unlock()
		s.store.Drop(p.Code)
		partyError(w, err, http.StatusInternalServerError, "server_error", "Failed to create party.")
		return
	}
	m.Reactions = req.Wants(protocol.FeatureReactions)
	body := membership(p, m)
	p.Unlock()

	jsonResponse(w, http.StatusCreated, body)
}

func (s *Server) handleJoinParty(w http.ResponseWriter, r *http.Request) {
	var req protocol.JoinRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	if err := req.Validate(); err != nil {
		jsonError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	p := s.lookup(w, r)
	if p == nil {
		return
	}

	p.Lock()
	rejoin := p.MemberByDevice(req.DeviceId) != nil
	m, err := p.Join(req.UserId, req.DeviceId, req.DisplayName, req.AvatarUrl)
	if err != nil {
		p.Unlock()
		partyError(w, err, http.StatusInternalServerError, "server_error", "Failed to join party.")
		return
	}
	m.Reactions = req.Wants(protocol.FeatureReactions)
	body := membership(p, m)
	p.Unlock()

	if rejoin {
		// The token just changed, so the socket opened with the old one is
		// no longer this member's: close it rather than let two run as one.
		s.hub.CloseMember(p.Code, m.MemberId)
	}
	jsonResponse(w, http.StatusOK, body)
}

// handlePreviewParty answers who is in a party, without a token and without
// joining it: what joining would show a second later. It is counted like every
// other lookup, so it can't be used to sweep the code space.
func (s *Server) handlePreviewParty(w http.ResponseWriter, r *http.Request) {
	p := s.lookup(w, r)
	if p == nil {
		return
	}

	p.Lock()
	// Joined order, as the snapshot uses: the caller draws the first few faces
	// and counts the rest, so which faces those are must not change between two
	// reads of an unchanged party.
	ordered := make([]*party.Member, 0, len(p.Members))
	for _, m := range p.Members {
		ordered = append(ordered, m)
	}
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].JoinedAtMs < ordered[j].JoinedAtMs
	})
	members := make([]map[string]interface{}, 0, len(ordered))
	hostName := ""
	for _, m := range ordered {
		members = append(members, map[string]interface{}{
			"displayName": m.DisplayName,
			"avatarUrl":   m.AvatarUrl,
			"isHost":      m.IsHost,
		})
		if m.IsHost {
			hostName = m.DisplayName
		}
	}
	preview := map[string]interface{}{
		"code":        p.Code,
		"hostName":    hostName,
		"memberCount": len(p.Members),
		"maxMembers":  p.MaxMembers,
		"isFull":      len(p.Members) >= p.MaxMembers,
		"members":     members,
	}
	p.Unlock()

	jsonResponse(w, http.StatusOK, preview)
}

// authenticated finds the party and the member a bearer token belongs to. A
// wrong token is a miss like a wrong code, with the same answer.
func (s *Server) authenticated(w http.ResponseWriter, r *http.Request) (*party.Party, *party.Member) {
	token := parseBearerToken(r)
	if token == "" {
		jsonError(w, http.StatusUnauthorized, "unauthorized", "Missing bearer token.")
		return nil, nil
	}
	return s.member(w, r, token)
}

func (s *Server) handleGetParty(w http.ResponseWriter, r *http.Request) {
	p, m := s.authenticated(w, r)
	if p == nil {
		return
	}
	p.Lock()
	if !p.IsMember(m) {
		p.Unlock()
		jsonError(w, http.StatusNotFound, "no_such_party", "No party with that code.")
		return
	}
	body := p.ToWire()
	p.Unlock()
	jsonResponse(w, http.StatusOK, body)
}

func (s *Server) handleLeaveParty(w http.ResponseWriter, r *http.Request) {
	p, m := s.authenticated(w, r)
	if p == nil {
		return
	}
	p.Lock()
	if p.Remove(m.MemberId) == nil {
		p.Unlock()
		jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	members := membersFrame(p)
	p.Unlock()

	// Tell the leaving device, then close its socket: it is no longer part
	// of the party.
	s.hub.Send(p.Code, m.MemberId, map[string]interface{}{
		"type":   protocol.FrameBye,
		"reason": "left",
	})
	s.hub.CloseMember(p.Code, m.MemberId)
	s.hub.Broadcast(p.Code, members, m.MemberId)

	jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
}
