package listen

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/Wavebit-app/wavebit/server/clock"
	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/hub"
	"github.com/Wavebit-app/wavebit/server/party"
	"github.com/Wavebit-app/wavebit/server/protocol"
)

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := parseSocketToken(r)
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	p, member := s.member(w, r, token)
	if p == nil {
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(config.WebSocketMaxBytes)

	// Membership is checked again now the socket is open: a leave or a removal
	// can land between the token check and here.
	p.Lock()
	if !p.IsMember(member) {
		p.Unlock()
		_ = conn.Close()
		return
	}
	p.MarkConnected(member, true)
	var features []string
	if member.Reactions {
		features = append(features, protocol.FeatureReactions)
	}
	// Attached and welcomed under the party lock, so no frame about this party
	// can reach the socket ahead of its welcome.
	c := s.hub.Attach(p.Code, member.MemberId, conn, features)
	c.SendJSON(map[string]interface{}{
		"type":     protocol.FrameWelcome,
		"you":      member.ToWire(),
		"party":    p.ToWire(),
		"serverMs": clock.NowMs(),
		"features": protocol.Features,
	})
	s.hub.Broadcast(p.Code, membersFrame(p), "")
	p.Unlock()

	idleFor := time.Duration(config.ConnectionIdleMs) * time.Millisecond
	idle := time.AfterFunc(idleFor, c.Close)

	defer func() {
		idle.Stop()
		c.Close()
		// Under the party lock, like Attach: a new socket can't mark the
		// member connected between this one leaving and saying so.
		p.Lock()
		current := s.hub.Detach(p.Code, member.MemberId, c)
		if !current || !p.IsMember(member) {
			// A newer socket took over, or the member is gone.
			p.Unlock()
			return
		}
		p.MarkConnected(member, false)
		mf := membersFrame(p)
		p.Unlock()
		s.hub.Broadcast(p.Code, mf, "")
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		c.ExtendRead()
		idle.Reset(idleFor)
		var frame map[string]interface{}
		if json.Unmarshal(data, &frame) != nil {
			frame = nil
		}
		if !s.handleSocketFrame(p, member, c, frame) {
			return
		}
	}
}

// handleSocketFrame acts on one frame. It reports false when the socket
// should close: the member is no longer in the party, or keeps flooding.
func (s *Server) handleSocketFrame(p *party.Party, member *party.Member, c *hub.Client, frame map[string]interface{}) bool {
	p.Lock()
	defer p.Unlock()
	if !p.IsMember(member) {
		return false
	}
	// Every frame pays, typed or not.
	if !p.SpendFrameBudget(member) {
		// Counted while it lasts: a socket that keeps flooding is closed,
		// one that went over once in a long session is not.
		member.Violations++
		if member.Violations > config.MaxBudgetViolations {
			return false
		}
		c.SendJSON(map[string]interface{}{
			"type": protocol.FrameError, "error": "rate_limited", "message": "Too many messages at once.",
		})
		return true
	}

	member.Violations = 0
	member.LastSeenMs = clock.NowMs()
	kind, _ := frame["type"].(string)

	switch kind {
	case protocol.FramePing:
		// Echoed only as a number: it is the client's own clock reading.
		clientMs, _ := frame["clientMs"].(float64)
		c.SendJSON(map[string]interface{}{
			"type":     protocol.FramePong,
			"clientMs": clientMs,
			"serverMs": clock.NowMs(),
		})

	case protocol.FrameSync:
		c.SendJSON(stateFrame(p))

	case protocol.FrameSyncQueue:
		c.SendJSON(queueFrame(p))

	case protocol.FrameReport:
		// A device's own playhead; nothing here needs it.

	case protocol.FrameReact:
		s.react(p, member, frame)

	case protocol.FrameControl:
		if !p.SpendControlBudget(member) {
			c.SendJSON(map[string]interface{}{
				"type":    protocol.FrameError,
				"error":   "rate_limited",
				"message": "Too many controls at once.",
			})
			return true
		}

		queueBefore := p.Playback.QueueSeq
		action, _ := frame["action"].(string)
		if protocol.QueueActions[action] && !p.SpendQueueBudget(member) {
			c.SendJSON(map[string]interface{}{
				"type":    protocol.FrameError,
				"error":   "rate_limited",
				"message": "Too many queue changes at once.",
			})
			return true
		}
		success, errCode, errMsg := s.applyControl(p, member, action, frame)
		if success {
			p.Touch()
			// If queue changed, broadcast queue first
			if p.Playback.QueueSeq != queueBefore {
				s.hub.Broadcast(p.Code, queueFrame(p), "")
			}
			s.hub.Broadcast(p.Code, stateFrame(p), "")
			if action == protocol.ActionKick ||
				action == protocol.ActionSetMaxMembers ||
				action == protocol.ActionSetHostOnlyControl {
				s.hub.Broadcast(p.Code, membersFrame(p), "")
			}
			s.hub.Broadcast(p.Code, activityFrame(member, action, frame), "")
		} else if errCode != "" {
			c.SendJSON(map[string]interface{}{
				"type":    protocol.FrameError,
				"error":   errCode,
				"message": errMsg,
			})
		}
	}
	return true
}

// react passes a reaction to every socket whose app can show one. An unknown
// id or a spent allowance is dropped without an answer: a reaction is never
// worth an error on someone's screen. Host-only control doesn't apply, since a
// reaction changes nothing anyone hears.
func (s *Server) react(p *party.Party, member *party.Member, frame map[string]interface{}) {
	id, _ := frame["reaction"].(string)
	if !protocol.Reactions[id] || !p.SpendReactBudget(member) {
		return
	}
	p.ReactionSeq++
	s.hub.BroadcastTo(p.Code, map[string]interface{}{
		"type":     protocol.FrameReaction,
		"id":       p.ReactionSeq,
		"memberId": member.MemberId,
		"reaction": id,
		"atMs":     clock.NowMs(),
	}, "", protocol.FeatureReactions)
}

func (s *Server) heartbeat() {
	now := clock.NowMs()
	for _, p := range s.store.All() {
		if len(s.hub.MembersOnline(p.Code)) == 0 {
			continue
		}
		p.Lock()
		sf := stateFrame(p)
		p.Unlock()
		s.hub.Broadcast(p.Code, sf, "")
	}

	for _, p := range s.store.Sweep(now) {
		p.Lock()
		mf := membersFrame(p)
		p.Unlock()
		s.hub.Broadcast(p.Code, mf, "")
	}

	live := make(map[string]bool)
	for _, p := range s.store.All() {
		live[p.Code] = true
	}
	for _, code := range s.hub.ActiveCodes() {
		if !live[code] {
			s.hub.DropParty(code)
		}
	}
}
