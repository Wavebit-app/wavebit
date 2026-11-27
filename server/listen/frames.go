package listen

import (
	"fmt"

	"github.com/Wavebit-app/wavebit/server/clean"
	"github.com/Wavebit-app/wavebit/server/clock"
	"github.com/Wavebit-app/wavebit/server/party"
	"github.com/Wavebit-app/wavebit/server/protocol"
)

// Frame builders

func stateFrame(p *party.Party) map[string]interface{} {
	return map[string]interface{}{
		"type":     protocol.FrameState,
		"playback": p.Playback.ToWire(clock.NowMs()),
		"serverMs": clock.NowMs(),
	}
}

func activityFrame(member *party.Member, action string, frame map[string]interface{}) map[string]interface{} {
	detail := action
	// Shown by BitChord's apps, so cleaned like every other title, and only
	// for a track the server took.
	trackTitle := func(raw interface{}) string {
		track, _ := raw.(map[string]interface{})
		if accepted := party.TrackFromWire(track); accepted != nil {
			return clean.Text(accepted.Title, 120)
		}
		return ""
	}
	switch action {
	case protocol.ActionSetTrack:
		if title := trackTitle(frame["track"]); title != "" {
			detail = "Changed the song to \"" + title + "\""
		}
	case protocol.ActionQueueAdd:
		if tracks, ok := frame["tracks"].([]interface{}); ok && len(tracks) > 0 {
			title := trackTitle(tracks[0])
			if title != "" {
				if len(tracks) == 1 {
					detail = "Added \"" + title + "\" to the queue"
				} else {
					detail = fmt.Sprintf("Added \"%s\" and %d more to the queue", title, len(tracks)-1)
				}
			}
		}
	case protocol.ActionSetQueue:
		if tracks, ok := frame["queue"].([]interface{}); ok {
			detail = fmt.Sprintf("Replaced the queue with %d tracks", len(tracks))
		}
	case protocol.ActionQueueRemove:
		detail = "Removed a track from the queue"
	case protocol.ActionQueueClear:
		detail = "Cleared upcoming tracks"
	case protocol.ActionQueueMove:
		detail = "Reordered the upcoming queue"
	case protocol.ActionNext:
		detail = "Skipped to the next song"
	case protocol.ActionPrevious:
		detail = "Went back to the previous song"
	case protocol.ActionPlay:
		detail = "Started playback"
	case protocol.ActionPause:
		detail = "Paused playback"
	case protocol.ActionSeek:
		detail = "Changed the playback position"
	case protocol.ActionKick:
		detail = "Removed a listener from the party"
	case protocol.ActionSetMaxMembers:
		detail = "Changed the party size"
	case protocol.ActionSetAutoplay:
		detail = "Changed AutoPlay"
	}
	return map[string]interface{}{"type": protocol.FrameActivity, "action": action, "by": member.DisplayName, "detail": detail, "atMs": clock.NowMs()}
}

func queueFrame(p *party.Party) map[string]interface{} {
	return map[string]interface{}{
		"type":     protocol.FrameQueue,
		"queue":    p.Playback.QueueToWire(),
		"serverMs": clock.NowMs(),
	}
}

func membersFrame(p *party.Party) map[string]interface{} {
	membersList := make([]map[string]interface{}, 0, len(p.Members))
	for _, m := range p.Members {
		membersList = append(membersList, m.ToWire())
	}
	return map[string]interface{}{
		"type":            protocol.FrameMembers,
		"members":         membersList,
		"maxMembers":      p.MaxMembers,
		"hostOnlyControl": p.HostOnlyControl,
		"serverMs":        clock.NowMs(),
	}
}
