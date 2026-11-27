package protocol

import (
	_ "embed"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/Wavebit-app/wavebit/server/clean"
)

// Server -> Client frame types
const (
	FrameWelcome  = "welcome"
	FrameState    = "state"
	FrameQueue    = "queue"
	FrameMembers  = "members"
	FramePong     = "pong"
	FrameError    = "error"
	FrameBye      = "bye"
	FrameActivity = "activity"
	// FrameReaction is sent only to members whose app said it understands
	// reactions when it joined (JoinRequest.Features).
	FrameReaction = "reaction"
)

// Client -> Server frame types
const (
	FramePing      = "ping"
	FrameControl   = "control"
	FrameSync      = "sync"
	FrameSyncQueue = "syncQueue"
	FrameReport    = "report"
	FrameReact     = "react"
)

// Control actions
const (
	ActionPlay               = "play"
	ActionPause              = "pause"
	ActionSeek               = "seek"
	ActionSetTrack           = "setTrack"
	ActionSetQueue           = "setQueue"
	ActionQueueAdd           = "queueAdd"
	ActionQueueRemove        = "queueRemove"
	ActionQueueClear         = "queueClear"
	ActionQueueMove          = "queueMove"
	ActionNext               = "next"
	ActionPrevious           = "previous"
	ActionKick               = "kick"
	ActionSetMaxMembers      = "setMaxMembers"
	ActionSetAutoplay        = "setAutoplay"
	ActionSetHostOnlyControl = "setHostOnlyControl"
)

// FeatureReactions is what a server offers, and what an app declares it can
// show, for party reactions.
const FeatureReactions = "reactions"

// Features is what this server adds to BitChord's protocol. It is sent on
// GET / and on the welcome frame. A server that sends none (BitChord's own)
// offers none.
var Features = []string{FeatureReactions}

//go:embed reactions.json
var reactionsJSON []byte

// Reactions are the ids a member may react with. The apps draw each id
// themselves, so what travels is never an emoji or any text of the sender's.
// wavebit's Rust client checks its own copy against this file.
var Reactions = func() map[string]bool {
	var ids []string
	if err := json.Unmarshal(reactionsJSON, &ids); err != nil || len(ids) == 0 {
		panic("protocol: reactions.json is not a list of ids")
	}
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set
}()

// QueueActions change the queue, and each sends the whole queue to everyone.
var QueueActions = map[string]bool{
	ActionSetQueue:    true,
	ActionQueueAdd:    true,
	ActionQueueRemove: true,
	ActionQueueClear:  true,
	ActionQueueMove:   true,
}

// ControlActions are the actions a party's HostOnlyControl setting restricts to
// the host. Membership actions are not here: kick and setMaxMembers are already
// host-only unconditionally, and setHostOnlyControl has to stay reachable by
// the host to be turned back off.
var ControlActions = map[string]bool{
	ActionPlay:        true,
	ActionPause:       true,
	ActionSeek:        true,
	ActionSetTrack:    true,
	ActionSetQueue:    true,
	ActionQueueAdd:    true,
	ActionQueueRemove: true,
	ActionQueueClear:  true,
	ActionQueueMove:   true,
	ActionNext:        true,
	ActionPrevious:    true,
	ActionSetAutoplay: true,
}

// JoinRequest is the identity submitted when creating or joining a party.
type JoinRequest struct {
	UserId          string   `json:"userId"`
	DeviceId        string   `json:"deviceId"`
	DisplayName     string   `json:"displayName"`
	AvatarUrl       *string  `json:"avatarUrl,omitempty"`
	MaxMembers      *int     `json:"maxMembers,omitempty"`
	AutoplayEnabled *bool    `json:"autoplayEnabled,omitempty"`
	Features        []string `json:"features,omitempty"`
}

// Validate ensures all required identity fields are present and safe. A
// picture that isn't on one of the app's picture hosts is dropped, not refused,
// so an older client still joins.
func (r *JoinRequest) Validate() error {
	r.UserId = strings.TrimSpace(r.UserId)
	if r.UserId == "" || len(r.UserId) > 128 {
		return errors.New("userId must be between 1 and 128 characters")
	}

	r.DeviceId = strings.TrimSpace(r.DeviceId)
	if r.DeviceId == "" || len(r.DeviceId) > 128 {
		return errors.New("deviceId must be between 1 and 128 characters")
	}

	if utf8.RuneCountInString(strings.TrimSpace(r.DisplayName)) > 80 {
		return errors.New("displayName must be between 1 and 80 characters")
	}
	r.DisplayName = clean.Text(r.DisplayName, 80)
	if r.DisplayName == "" {
		return errors.New("displayName must be between 1 and 80 characters")
	}

	if r.AvatarUrl != nil {
		r.AvatarUrl = clean.ImageURL(*r.AvatarUrl)
	}
	if r.MaxMembers != nil && (*r.MaxMembers < 2 || *r.MaxMembers > 10) {
		return errors.New("maxMembers must be between 2 and 10")
	}
	if len(r.Features) > 8 {
		r.Features = r.Features[:8]
	}
	return nil
}

// Wants reports whether the joining app declared feature.
func (r *JoinRequest) Wants(feature string) bool {
	for _, f := range r.Features {
		if f == feature {
			return true
		}
	}
	return false
}
