package party

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"

	"github.com/Wavebit-app/wavebit/server/clean"
	"github.com/Wavebit-app/wavebit/server/clock"
	"github.com/Wavebit-app/wavebit/server/codes"
	"github.com/Wavebit-app/wavebit/server/config"
)

// PartyError represents an error with an HTTP status code and wire error code.
type PartyError struct {
	Status  int    `json:"status"`
	Code    string `json:"error"`
	Message string `json:"message"`
}

func (e *PartyError) Error() string {
	return e.Message
}

func NewPartyError(status int, code, message string) *PartyError {
	return &PartyError{Status: status, Code: code, Message: message}
}

// Track represents a song with metadata needed for display and synchronization.
type Track struct {
	VideoId      string  `json:"videoId"`
	Title        string  `json:"title"`
	Artist       string  `json:"artist"`
	ThumbnailUrl *string `json:"thumbnailUrl,omitempty"`
	DurationMs   *int64  `json:"durationMs,omitempty"`
	FromAutoplay bool    `json:"fromAutoplay"`
}

// TrackFromWire reads a track a member sent. It is shown on everybody's
// screen and its id decides what everybody plays, so an id that can't be a
// song refuses the track, and names and pictures are cleaned.
func TrackFromWire(raw map[string]interface{}) *Track {
	if raw == nil {
		return nil
	}
	vid, _ := raw["videoId"].(string)
	if !clean.VideoID(vid) {
		return nil
	}
	title, _ := raw["title"].(string)
	artist, _ := raw["artist"].(string)
	thumb, _ := raw["thumbnailUrl"].(string)

	var durPtr *int64
	if d, ok := raw["durationMs"].(float64); ok && d > 0 && d <= 24*60*60*1000 {
		dur := int64(d)
		durPtr = &dur
	}

	fromAutoplay, _ := raw["fromAutoplay"].(bool)

	return &Track{
		VideoId:      vid,
		Title:        clean.Text(title, 300),
		Artist:       clean.Text(artist, 300),
		ThumbnailUrl: clean.ImageURL(thumb),
		DurationMs:   durPtr,
		FromAutoplay: fromAutoplay,
	}
}

// PlaybackState tracks playhead, playback mode, anchor timestamps, and queue sequencing.
type PlaybackState struct {
	Track           *Track   `json:"track"`
	Queue           []*Track `json:"-"`
	QueueIndex      int      `json:"queueIndex"`
	IsPlaying       bool     `json:"isPlaying"`
	PositionMs      int64    `json:"positionMs"`
	AnchorMs        int64    `json:"anchorMs"`
	Seq             int      `json:"seq"`
	QueueSeq        int      `json:"queueSeq"`
	UpdatedBy       *string  `json:"updatedBy"`
	UpdatedAtMs     int64    `json:"updatedAtMs"`
	StartedBy       *string  `json:"startedBy"`
	StartedByName   *string  `json:"startedByName"`
	AutoplayEnabled bool     `json:"autoplayEnabled"`
}

func NewPlaybackState() *PlaybackState {
	now := clock.NowMs()
	return &PlaybackState{
		Queue:       make([]*Track, 0),
		QueueIndex:  -1,
		AnchorMs:    now,
		UpdatedAtMs: now,
	}
}

func (p *PlaybackState) PositionAt(serverMs int64) int64 {
	if !p.IsPlaying {
		return p.PositionMs
	}
	elapsed := serverMs - p.AnchorMs
	if elapsed < 0 {
		elapsed = 0
	}
	pos := p.PositionMs + elapsed
	if p.Track != nil && p.Track.DurationMs != nil && *p.Track.DurationMs > 0 {
		if pos > *p.Track.DurationMs {
			return *p.Track.DurationMs
		}
	}
	return pos
}

func (p *PlaybackState) touch(memberId *string) {
	p.Seq++
	p.UpdatedBy = memberId
	p.UpdatedAtMs = clock.NowMs()
}

func (p *PlaybackState) touchQueue(memberId *string) {
	p.trimHistory()
	p.QueueSeq++
	p.UpdatedBy = memberId
	p.UpdatedAtMs = clock.NowMs()
}

// trimHistory drops the oldest played songs once the whole queue passes
// MaxQueueTotal, so a long party's queue frames stay small.
func (p *PlaybackState) trimHistory() {
	excess := len(p.Queue) - config.MaxQueueTotal
	played := p.QueueIndex
	if played < 0 {
		played = 0
	}
	if excess > played {
		excess = played
	}
	if excess <= 0 {
		return
	}
	p.Queue = append([]*Track(nil), p.Queue[excess:]...)
	p.QueueIndex -= excess
}

func (p *PlaybackState) Play(memberId *string, positionMs *int64) {
	now := clock.NowMs()
	startAt := p.PositionAt(now)
	if positionMs != nil {
		startAt = *positionMs
	}
	if startAt < 0 {
		startAt = 0
	}
	p.PositionMs = startAt
	p.IsPlaying = true
	p.AnchorMs = now + int64(config.PlayLeadMs)
	p.touch(memberId)
}

func (p *PlaybackState) Pause(memberId *string, positionMs *int64) {
	now := clock.NowMs()
	pauseAt := p.PositionAt(now)
	if positionMs != nil {
		pauseAt = *positionMs
	}
	if pauseAt < 0 {
		pauseAt = 0
	}
	p.PositionMs = pauseAt
	p.IsPlaying = false
	p.AnchorMs = now
	p.touch(memberId)
}

func (p *PlaybackState) Seek(memberId *string, positionMs int64) {
	if positionMs < 0 {
		positionMs = 0
	}
	p.PositionMs = positionMs
	lead := int64(0)
	if p.IsPlaying {
		lead = int64(config.PlayLeadMs)
	}
	p.AnchorMs = clock.NowMs() + lead
	p.touch(memberId)
}

func (p *PlaybackState) SetTrack(
	memberId *string,
	track *Track,
	positionMs int64,
	isPlaying bool,
	queueIndex *int,
	memberName *string,
) {
	p.Track = track
	if positionMs < 0 {
		positionMs = 0
	}
	p.PositionMs = positionMs
	p.IsPlaying = isPlaying && track != nil
	lead := int64(0)
	if p.IsPlaying {
		lead = int64(config.PlayLeadMs)
	}
	p.AnchorMs = clock.NowMs() + lead

	if queueIndex != nil && *queueIndex >= 0 && *queueIndex < len(p.Queue) &&
		track != nil && p.Queue[*queueIndex].VideoId == track.VideoId {
		p.QueueIndex = *queueIndex
	} else if track != nil {
		p.QueueIndex = nearestIndexOf(p.Queue, track.VideoId, p.QueueIndex)
	} else if queueIndex != nil {
		p.QueueIndex = *queueIndex
	}

	p.StartedBy = memberId
	// A copy: the member's own name changes when they rejoin, while this is
	// read for frames after the party lock is gone.
	p.StartedByName = nil
	if memberName != nil {
		name := *memberName
		p.StartedByName = &name
	}
	p.touch(memberId)
}

func (p *PlaybackState) SetQueue(memberId *string, queue []*Track, queueIndex int) {
	// The sender's own index wins when it names the playing track. Searching
	// from the top instead found the copy of that track already in history
	// whenever it had played before, and every device then showed what came
	// after that old copy as still to come.
	if p.Track != nil {
		if queueIndex < 0 || queueIndex >= len(queue) || queue[queueIndex].VideoId != p.Track.VideoId {
			queueIndex = nearestIndexOf(queue, p.Track.VideoId, queueIndex)
		}
	}

	if queueIndex >= 0 && queueIndex < len(queue) {
		pastAndCurrent := queue[:queueIndex+1]
		endUpcoming := queueIndex + 1 + config.MaxUpcomingQueue
		if endUpcoming > len(queue) {
			endUpcoming = len(queue)
		}
		upcoming := queue[queueIndex+1 : endUpcoming]
		newQ := make([]*Track, 0, len(pastAndCurrent)+len(upcoming))
		newQ = append(newQ, pastAndCurrent...)
		newQ = append(newQ, upcoming...)
		p.Queue = newQ
		p.QueueIndex = queueIndex
	} else {
		maxLen := config.MaxQueueLength
		if len(queue) < maxLen {
			maxLen = len(queue)
		}
		p.Queue = queue[:maxLen]
		if queueIndex >= 0 && queueIndex < len(p.Queue) {
			p.QueueIndex = queueIndex
		} else {
			p.QueueIndex = -1
		}
	}
	p.touchQueue(memberId)
}

// nearestIndexOf finds videoId in queue closest to around: the slot right after
// it first (the queue moving on), then the one before it (going back), then
// the nearest copy either way. A queue can hold one track twice, once played
// and once to come, and the first copy from the top is the wrong one as often
// as not.
func nearestIndexOf(queue []*Track, videoId string, around int) int {
	if around+1 >= 0 && around+1 < len(queue) && queue[around+1].VideoId == videoId {
		return around + 1
	}
	if around-1 >= 0 && around-1 < len(queue) && queue[around-1].VideoId == videoId {
		return around - 1
	}
	best := -1
	bestDistance := 0
	for i, item := range queue {
		if item.VideoId != videoId {
			continue
		}
		distance := i - around
		if distance < 0 {
			// Behind the needle costs a little more than ahead of it.
			distance = -distance*2 + 1
		}
		if best == -1 || distance < bestDistance {
			best = i
			bestDistance = distance
		}
	}
	return best
}

// withoutQueuedAutoplay drops AutoPlay suggestions that are already waiting
// after the current track, or repeated within the batch. Two devices can both
// believe they supply AutoPlay for a moment (a host reconnecting), and one can
// retry before its first batch has echoed back; either way the same station
// arrives twice and the queue shows every suggestion twice. Tracks somebody
// queued by hand are never filtered: queueing a song twice is allowed.
func withoutQueuedAutoplay(queue []*Track, queueIndex int, tracks []*Track) []*Track {
	waiting := make(map[string]bool)
	for i := queueIndex + 1; i < len(queue); i++ {
		if i >= 0 {
			waiting[queue[i].VideoId] = true
		}
	}
	out := make([]*Track, 0, len(tracks))
	for _, t := range tracks {
		if t == nil {
			continue
		}
		if t.FromAutoplay {
			if waiting[t.VideoId] {
				continue
			}
			waiting[t.VideoId] = true
		}
		out = append(out, t)
	}
	return out
}

func (p *PlaybackState) AddUpcoming(memberId *string, tracks []*Track, playNext bool) (bool, string) {
	currentUpcoming := 0
	if p.QueueIndex >= 0 {
		currentUpcoming = len(p.Queue) - 1 - p.QueueIndex
		if currentUpcoming < 0 {
			currentUpcoming = 0
		}
	} else {
		currentUpcoming = len(p.Queue)
	}

	slotsLeft := config.MaxUpcomingQueue - currentUpcoming
	if slotsLeft <= 0 {
		return false, "queue_full"
	}

	toAdd := withoutQueuedAutoplay(p.Queue, p.QueueIndex, tracks)
	if len(toAdd) == 0 && len(tracks) > 0 {
		// Every suggestion is already waiting in the queue: a second supplier,
		// or the same one retrying before its first batch came back. Nothing to
		// do is not a refusal, so the sender's echo wait still completes.
		return true, ""
	}
	if len(toAdd) > slotsLeft {
		toAdd = toAdd[:slotsLeft]
	}
	if len(toAdd) == 0 {
		return false, "no_tracks"
	}

	if playNext && p.QueueIndex >= 0 && p.QueueIndex < len(p.Queue) {
		insertAt := p.QueueIndex + 1
		newQ := make([]*Track, 0, len(p.Queue)+len(toAdd))
		newQ = append(newQ, p.Queue[:insertAt]...)
		newQ = append(newQ, toAdd...)
		newQ = append(newQ, p.Queue[insertAt:]...)
		p.Queue = newQ
	} else {
		p.Queue = append(p.Queue, toAdd...)
	}

	p.touchQueue(memberId)
	return true, ""
}

func (p *PlaybackState) RemoveUpcoming(memberId *string, videoId string) bool {
	match := -1
	for i, item := range p.Queue {
		if item.VideoId == videoId {
			match = i
			break
		}
	}
	if match == -1 || match == p.QueueIndex {
		return false
	}

	p.Queue = append(p.Queue[:match], p.Queue[match+1:]...)
	if p.QueueIndex > match {
		p.QueueIndex--
	}
	p.touchQueue(memberId)
	return true
}

func (p *PlaybackState) ClearUpcoming(memberId *string) bool {
	if p.QueueIndex >= 0 {
		if len(p.Queue) <= p.QueueIndex+1 {
			return false
		}
		p.Queue = p.Queue[:p.QueueIndex+1]
	} else {
		if len(p.Queue) == 0 {
			return false
		}
		p.Queue = p.Queue[:0]
	}
	p.touchQueue(memberId)
	return true
}

func (p *PlaybackState) MoveUpcoming(memberId *string, fromIdx, toIdx int, videoId string) bool {
	if videoId != "" {
		match := -1
		for i, item := range p.Queue {
			if item.VideoId == videoId {
				match = i
				break
			}
		}
		if match == -1 {
			return false
		}
		fromIdx = match
	}

	if fromIdx < 0 || fromIdx >= len(p.Queue) || toIdx < 0 || toIdx >= len(p.Queue) {
		return false
	}
	if fromIdx <= p.QueueIndex || toIdx <= p.QueueIndex {
		return false
	}
	if fromIdx == toIdx {
		return true
	}

	item := p.Queue[fromIdx]
	p.Queue = append(p.Queue[:fromIdx], p.Queue[fromIdx+1:]...)
	// Insert at toIdx
	newQ := make([]*Track, 0, len(p.Queue)+1)
	newQ = append(newQ, p.Queue[:toIdx]...)
	newQ = append(newQ, item)
	newQ = append(newQ, p.Queue[toIdx:]...)
	p.Queue = newQ

	p.touchQueue(memberId)
	return true
}

func (p *PlaybackState) Step(memberId *string, delta int, memberName *string) bool {
	target := p.QueueIndex + delta
	if target < 0 || target >= len(p.Queue) {
		return false
	}
	p.SetTrack(memberId, p.Queue[target], 0, true, &target, memberName)
	return true
}

func (p *PlaybackState) ToWire(serverMs int64) map[string]interface{} {
	var trackWire interface{}
	if p.Track != nil {
		trackWire = p.Track
	}

	return map[string]interface{}{
		"seq":                 p.Seq,
		"track":               trackWire,
		"queueSeq":            p.QueueSeq,
		"queueIndex":          p.QueueIndex,
		"queueLength":         len(p.Queue),
		"isPlaying":           p.IsPlaying,
		"positionMs":          p.PositionMs,
		"anchorMs":            p.AnchorMs,
		"effectivePositionMs": p.PositionAt(serverMs),
		"updatedBy":           p.UpdatedBy,
		"startedBy":           p.StartedBy,
		"startedByName":       p.StartedByName,
		"autoplayEnabled":     p.AutoplayEnabled,
		"updatedAtMs":         p.UpdatedAtMs,
	}
}

// SetAutoplay changes the party-wide AutoPlay choice. It belongs to playback
// state so a replacement AutoPlay supplier can continue after the host leaves.
func (p *PlaybackState) SetAutoplay(memberId *string, enabled bool) {
	if p.AutoplayEnabled == enabled {
		return
	}
	p.AutoplayEnabled = enabled
	p.UpdatedBy = memberId
	p.UpdatedAtMs = clock.NowMs()
}

func (p *PlaybackState) QueueToWire() map[string]interface{} {
	return map[string]interface{}{
		"seq":   p.QueueSeq,
		"index": p.QueueIndex,
		// A copy: queue edits shift the live slice in place, and frames are
		// encoded after the party lock is released.
		"items": append([]*Track(nil), p.Queue...),
	}
}

// Member represents a joined device.
type Member struct {
	MemberId          string  `json:"memberId"`
	UserId            string  `json:"userId"`
	DeviceId          string  `json:"-"`
	DisplayName       string  `json:"displayName"`
	AvatarUrl         *string `json:"avatarUrl,omitempty"`
	Token             string  `json:"-"`
	IsHost            bool    `json:"isHost"`
	Connected         bool    `json:"connected"`
	JoinedAtMs        int64   `json:"joinedAtMs"`
	LastSeenMs        int64   `json:"lastSeenMs"`
	ControlBudget     float64 `json:"-"`
	ControlBudgetAtMs int64   `json:"-"`
	FrameBudget       float64 `json:"-"`
	FrameBudgetAtMs   int64   `json:"-"`
	// Reactions is whether this member's app said it can show reactions.
	Reactions       bool    `json:"-"`
	ReactBudget     float64 `json:"-"`
	ReactBudgetAtMs int64   `json:"-"`
	// Violations counts frames refused for being over budget; too many closes
	// the socket.
	Violations      int `json:"-"`
	publicUserId    string
	ReclaimedAtMs   int64   `json:"-"`
	QueueBudget     float64 `json:"-"`
	QueueBudgetAtMs int64   `json:"-"`
}

func (m *Member) ToWire() map[string]interface{} {
	return map[string]interface{}{
		"memberId":    m.MemberId,
		"userId":      m.publicUserId,
		"displayName": m.DisplayName,
		"avatarUrl":   m.AvatarUrl,
		"isHost":      m.IsHost,
		"connected":   m.Connected,
		"joinedAtMs":  m.JoinedAtMs,
		"lastSeenMs":  m.LastSeenMs,
	}
}

// Party holds members and playback state for a single room code.
type Party struct {
	mu         sync.Mutex
	Code       string
	Members    map[string]*Member
	Playback   *PlaybackState
	MaxMembers int
	// HostOnlyControl restricts every playback and queue action to the host.
	//
	// Deliberately on Party rather than on PlaybackState: it changes rarely and
	// PlaybackState.ToWire rides the heartbeat to every device every few
	// seconds. It travels with MaxMembers on the members frame instead, which
	// is only sent when something about the membership actually changes.
	HostOnlyControl bool
	CreatedAtMs     int64
	TouchedAtMs     int64
	EmptySinceMs    *int64
	// CreatorKey is the address (an IPv6 /64) that created the party, for the
	// per-address limit on live parties.
	CreatorKey string
	NetworkKey string
	// EverConnected is false until somebody opens a socket. A party nobody
	// ever connects to is dropped after UnclaimedPartyTTLMs.
	EverConnected bool
	// removed holds the devices the host removed, kept out for the rest of
	// the party.
	removed map[string]bool
	// The party's own reaction allowance, on top of each member's.
	reactBudget   float64
	reactBudgetAt int64
	// ReactionSeq numbers reactions so a device never shows one twice.
	ReactionSeq int64
}

func NewParty(code string) *Party {
	return NewPartyWithMaxMembers(code, config.MaxMembers)
}

func NewPartyWithMaxMembers(code string, maxMembers int) *Party {
	if maxMembers < 2 || maxMembers > 10 {
		maxMembers = 5
	}
	now := clock.NowMs()
	empty := now
	return &Party{
		Code:          code,
		Members:       make(map[string]*Member),
		Playback:      NewPlaybackState(),
		MaxMembers:    maxMembers,
		CreatedAtMs:   now,
		TouchedAtMs:   now,
		EmptySinceMs:  &empty,
		removed:       make(map[string]bool),
		reactBudget:   config.PartyReactRatePerSecond,
		reactBudgetAt: now,
	}
}

func (p *Party) Lock()   { p.mu.Lock() }
func (p *Party) Unlock() { p.mu.Unlock() }

func (p *Party) Touch() {
	p.TouchedAtMs = clock.NowMs()
}

func (p *Party) Host() *Member {
	for _, m := range p.Members {
		if m.IsHost {
			return m
		}
	}
	return nil
}

// MemberByDevice is the member that joined from deviceId, if any.
func (p *Party) MemberByDevice(deviceId string) *Member {
	for _, m := range p.Members {
		if m.DeviceId == deviceId {
			return m
		}
	}
	return nil
}

// reclaimQuietMs is how long a connected member's socket must have been
// silent before its device id may take the place back. Apps ping every few
// seconds, so a live one never is.
const reclaimQuietMs = 35_000

// publicUserId is what other members see as a member's user id: the same
// for one person's devices within a party, different in every party, so
// nobody can follow someone from party to party by it.
func publicUserId(code, userId string) string {
	sum := sha256.Sum256([]byte("wavebit-party|" + code + "|" + userId))
	return hex.EncodeToString(sum[:16])
}

func (p *Party) Join(userId, deviceId, displayName string, avatarUrl *string) (*Member, error) {
	now := clock.NowMs()
	if p.removed[deviceId] || p.removed["u:"+userId] {
		return nil, NewPartyError(403, "removed", "The host removed this device from the party.")
	}
	// Rejoining device check. The caller closes the old socket, since the old
	// token stops working here.
	for _, m := range p.Members {
		if m.DeviceId == deviceId {
			// A device id is only as secret as the app keeps it, so a place
			// whose socket is alive and talking can't be taken over with it.
			// A device that crashed falls silent, and gets its place back.
			if m.Connected && now-m.LastSeenMs < reclaimQuietMs {
				return nil, NewPartyError(409, "already_connected", "This device is still connected to that party.")
			}
			if m.ReclaimedAtMs != 0 && now-m.ReclaimedAtMs < 2000 {
				return nil, NewPartyError(429, "rejoin_too_fast", "Wait a moment before rejoining.")
			}
			m.ReclaimedAtMs = now
			m.DisplayName = displayName
			m.AvatarUrl = avatarUrl
			m.UserId = userId
			m.publicUserId = publicUserId(p.Code, userId)
			m.LastSeenMs = now
			m.Token = randomToken(24)
			p.Touch()
			return m, nil
		}
	}

	if len(p.Members) >= p.MaxMembers {
		return nil, NewPartyError(409, "party_full", fmt.Sprintf("This party is full (%d devices).", p.MaxMembers))
	}

	m := &Member{
		MemberId:          randomHex(8),
		UserId:            userId,
		publicUserId:      publicUserId(p.Code, userId),
		DeviceId:          deviceId,
		DisplayName:       displayName,
		AvatarUrl:         avatarUrl,
		Token:             randomToken(24),
		IsHost:            len(p.Members) == 0,
		Connected:         false,
		JoinedAtMs:        now,
		LastSeenMs:        now,
		ControlBudget:     config.ControlRatePerSecond,
		ControlBudgetAtMs: now,
		FrameBudget:       config.FrameRatePerSecond,
		FrameBudgetAtMs:   now,
		ReactBudget:       config.ReactBurst,
		ReactBudgetAtMs:   now,
	}
	p.Members[m.MemberId] = m
	p.Touch()
	return m, nil
}

func (p *Party) SetMaxMembers(member *Member, maxMembers int) error {
	if !member.IsHost {
		return NewPartyError(403, "host_only", "Only the host can change the party size.")
	}
	if maxMembers < 2 || maxMembers > 10 {
		return NewPartyError(422, "invalid_capacity", "Party size must be between 2 and 10.")
	}
	if maxMembers < len(p.Members) {
		return NewPartyError(409, "party_too_small", "Party size cannot be smaller than the current member count.")
	}
	p.MaxMembers = maxMembers
	p.Touch()
	return nil
}

// SetHostOnlyControl restricts the music to the host, or hands it back to
// everyone. Host-only, like SetMaxMembers: a listener who could turn this off
// is not restricted by it.
func (p *Party) SetHostOnlyControl(member *Member, enabled bool) error {
	if !member.IsHost {
		return NewPartyError(403, "host_only", "Only the host can change who controls the music.")
	}
	if p.HostOnlyControl == enabled {
		return nil
	}
	p.HostOnlyControl = enabled
	p.Touch()
	return nil
}

// MayControl reports whether this member is allowed to drive playback and the
// queue right now.
//
// The host always may. Everyone else may until the host says otherwise — which
// is the behaviour this feature shipped with and stays the default for a party
// that never touches the setting.
func (p *Party) MayControl(member *Member) bool {
	return !p.HostOnlyControl || member.IsHost
}

func (p *Party) Authenticate(token string) (*Member, error) {
	for _, m := range p.Members {
		if subtle.ConstantTimeCompare([]byte(m.Token), []byte(token)) == 1 {
			return m, nil
		}
	}
	return nil, NewPartyError(401, "bad_token", "This device is not a member of that party.")
}

func (p *Party) Remove(memberId string) *Member {
	m, ok := p.Members[memberId]
	if !ok {
		return nil
	}
	delete(p.Members, memberId)
	wasHost := m.IsHost
	// A removed member keeps no rights, even through a socket that is still
	// open for a moment.
	m.IsHost = false
	if wasHost && len(p.Members) > 0 {
		// The longest-standing member, preferring one who is connected, so the
		// new host is predictable rather than whatever the map yields first.
		var next *Member
		for _, cand := range p.Members {
			if next == nil ||
				(cand.Connected && !next.Connected) ||
				(cand.Connected == next.Connected && cand.JoinedAtMs < next.JoinedAtMs) {
				next = cand
			}
		}
		next.IsHost = true
	}
	p.Touch()
	p.refreshEmptiness()
	return m
}

// Ban keeps a removed member's device out for the rest of the party.
func (p *Party) Ban(m *Member) {
	p.removed[m.DeviceId] = true
	p.removed["u:"+m.UserId] = true
}

// IsMember reports whether m is still in the party. A socket checks this on
// every frame, so leaving or being removed ends what that socket may do.
func (p *Party) IsMember(m *Member) bool {
	return p.Members[m.MemberId] == m
}

// SpendQueueBudget takes one queue edit from the member's allowance.
func (p *Party) SpendQueueBudget(member *Member) bool {
	now := clock.NowMs()
	if member.QueueBudgetAtMs == 0 {
		member.QueueBudget, member.QueueBudgetAtMs = config.QueueEditBurst, now
	}
	if elapsed := float64(now-member.QueueBudgetAtMs) / 1000.0; elapsed > 0 {
		member.QueueBudget += elapsed * config.QueueEditsPerSecond
	}
	if member.QueueBudget > config.QueueEditBurst {
		member.QueueBudget = config.QueueEditBurst
	}
	member.QueueBudgetAtMs = now
	if member.QueueBudget < 1 {
		return false
	}
	member.QueueBudget--
	return true
}

// SpendReactBudget takes one reaction from the member's allowance (a burst of
// ReactBurst, refilling at ReactRatePerSecond) and from the party's.
func (p *Party) SpendReactBudget(member *Member) bool {
	now := clock.NowMs()
	refill := func(budget *float64, at *int64, rate, burst float64) {
		if elapsed := float64(now-*at) / 1000.0; elapsed > 0 {
			*budget += elapsed * rate
		}
		if *budget > burst {
			*budget = burst
		}
		*at = now
	}
	refill(&member.ReactBudget, &member.ReactBudgetAtMs, config.ReactRatePerSecond, config.ReactBurst)
	refill(&p.reactBudget, &p.reactBudgetAt, config.PartyReactRatePerSecond, config.PartyReactRatePerSecond)
	if member.ReactBudget < 1 || p.reactBudget < 1 {
		return false
	}
	member.ReactBudget--
	p.reactBudget--
	return true
}

func (p *Party) SpendControlBudget(member *Member) bool {
	now := clock.NowMs()
	elapsedS := float64(now-member.ControlBudgetAtMs) / 1000.0
	if elapsedS < 0 {
		elapsedS = 0
	}
	member.ControlBudget = member.ControlBudget + elapsedS*config.ControlRatePerSecond
	if member.ControlBudget > config.ControlRatePerSecond {
		member.ControlBudget = config.ControlRatePerSecond
	}
	member.ControlBudgetAtMs = now
	if member.ControlBudget < 1.0 {
		return false
	}
	member.ControlBudget -= 1.0
	return true
}

// SpendFrameBudget limits every received WebSocket frame, not just controls.
// This prevents ping/sync frames from bypassing the control rate limit.
func (p *Party) SpendFrameBudget(member *Member) bool {
	now := clock.NowMs()
	elapsedS := float64(now-member.FrameBudgetAtMs) / 1000.0
	if elapsedS < 0 {
		elapsedS = 0
	}
	member.FrameBudget += elapsedS * config.FrameRatePerSecond
	if member.FrameBudget > config.FrameRatePerSecond {
		member.FrameBudget = config.FrameRatePerSecond
	}
	member.FrameBudgetAtMs = now
	if member.FrameBudget < 1.0 {
		return false
	}
	member.FrameBudget -= 1.0
	return true
}

func (p *Party) MarkConnected(member *Member, connected bool) {
	if connected {
		p.EverConnected = true
	}
	member.Connected = connected
	member.LastSeenMs = clock.NowMs()
	p.Touch()
	p.refreshEmptiness()
}

func (p *Party) refreshEmptiness() {
	anyConn := false
	for _, m := range p.Members {
		if m.Connected {
			anyConn = true
			break
		}
	}
	if anyConn {
		p.EmptySinceMs = nil
	} else if p.EmptySinceMs == nil {
		now := clock.NowMs()
		p.EmptySinceMs = &now
	}
}

func (p *Party) ExpiredMembers(now int64) []*Member {
	var expired []*Member
	for _, m := range p.Members {
		if !m.Connected && now-m.LastSeenMs > config.DisconnectGraceMs {
			expired = append(expired, m)
		}
	}
	return expired
}

func (p *Party) IsExpired(now int64) bool {
	if now-p.CreatedAtMs > config.PartyMaxAgeMs {
		return true
	}
	// Nobody left: whoever joined next would become host of a stranger's
	// party. The grace covers the moment between creating and joining.
	if len(p.Members) == 0 && now-p.CreatedAtMs > 5000 {
		return true
	}
	if !p.EverConnected && now-p.CreatedAtMs > config.UnclaimedPartyTTLMs {
		return true
	}
	if p.EmptySinceMs != nil {
		return now-*p.EmptySinceMs > config.EmptyPartyTTLMs
	}
	return false
}

func (p *Party) ToWire() map[string]interface{} {
	now := clock.NowMs()
	membersList := make([]*Member, 0, len(p.Members))
	for _, m := range p.Members {
		membersList = append(membersList, m)
	}
	sort.Slice(membersList, func(i, j int) bool {
		return membersList[i].JoinedAtMs < membersList[j].JoinedAtMs
	})

	membersWire := make([]map[string]interface{}, 0, len(membersList))
	for _, m := range membersList {
		membersWire = append(membersWire, m.ToWire())
	}

	return map[string]interface{}{
		"code":            p.Code,
		"createdAtMs":     p.CreatedAtMs,
		"maxMembers":      p.MaxMembers,
		"hostOnlyControl": p.HostOnlyControl,
		"members":         membersWire,
		"playback":        p.Playback.ToWire(now),
		"queue":           p.Playback.QueueToWire(),
		"serverMs":        now,
	}
}

// PartyStore holds all live parties in process memory.
type PartyStore struct {
	mu      sync.RWMutex
	parties map[string]*Party
}

func NewPartyStore() *PartyStore {
	return &PartyStore{
		parties: make(map[string]*Party),
	}
}

func (s *PartyStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.parties)
}

// MemberCount is the number of members across every live party. Parties are
// copied out first so no party lock is ever taken under the store lock.
func (s *PartyStore) MemberCount() int {
	s.mu.RLock()
	parties := make([]*Party, 0, len(s.parties))
	for _, p := range s.parties {
		parties = append(parties, p)
	}
	s.mu.RUnlock()
	total := 0
	for _, p := range parties {
		p.mu.Lock()
		total += len(p.Members)
		p.mu.Unlock()
	}
	return total
}

func (s *PartyStore) Create() (*Party, error) {
	return s.CreateWithLimit(0)
}

// CreateWithLimit atomically rejects creation once the service-wide room limit
// is reached. A non-positive limit means unlimited (used by unit tests).
func (s *PartyStore) CreateWithLimit(maxParties int) (*Party, error) {
	return s.CreateWithLimits(maxParties, config.MaxMembers)
}

func (s *PartyStore) CreateWithLimits(maxParties, maxMembers int) (*Party, error) {
	return s.CreateFor("", "", maxParties, maxMembers)
}

// CreateFor makes a party for creatorKey, refusing once that address already
// holds MaxPartiesPerClient live parties, or its network (an IPv6 /48,
// networkKey) MaxPartiesPerNetwork. Empty keys are not limited.
func (s *PartyStore) CreateFor(creatorKey, networkKey string, maxParties, maxMembers int) (*Party, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxParties > 0 && len(s.parties) >= maxParties {
		return nil, NewPartyError(503, "server_full", "The party server is busy. Please try again in a few minutes.")
	}
	if creatorKey != "" && config.MaxPartiesPerClient > 0 {
		held := 0
		for _, p := range s.parties {
			if p.CreatorKey == creatorKey {
				held++
			}
		}
		if held >= config.MaxPartiesPerClient {
			return nil, NewPartyError(429, "too_many_parties", "This network already has several parties running. End one first.")
		}
	}
	if networkKey != "" && config.MaxPartiesPerNetwork > 0 {
		held := 0
		for _, p := range s.parties {
			if p.NetworkKey == networkKey {
				held++
			}
		}
		if held >= config.MaxPartiesPerNetwork {
			return nil, NewPartyError(429, "too_many_parties", "This network already has several parties running. End one first.")
		}
	}

	for i := 0; i < 12; i++ {
		code := codes.NewCode()
		if _, exists := s.parties[code]; !exists {
			p := NewPartyWithMaxMembers(code, maxMembers)
			p.CreatorKey = creatorKey
			p.NetworkKey = networkKey
			s.parties[code] = p
			return p, nil
		}
	}
	return nil, NewPartyError(503, "code_exhausted", "Could not allocate a party code.")
}

func (s *PartyStore) Get(code string) (*Party, error) {
	norm := codes.Normalise(code)
	s.mu.RLock()
	p, ok := s.parties[norm]
	s.mu.RUnlock()
	if !ok {
		return nil, NewPartyError(404, "no_such_party", "No party with that code.")
	}
	return p, nil
}

func (s *PartyStore) Find(code string) *Party {
	norm := codes.Normalise(code)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.parties[norm]
}

func (s *PartyStore) Drop(code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.parties, code)
}

func (s *PartyStore) All() []*Party {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]*Party, 0, len(s.parties))
	for _, p := range s.parties {
		res = append(res, p)
	}
	return res
}

// Sweep removes members whose grace ran out and parties that are over. Each
// party is locked on its own, never under the store lock, so a party busy with
// one slow request can't hold up every lookup on the server.
func (s *PartyStore) Sweep(now int64) []*Party {
	var changed, over []*Party
	for _, party := range s.All() {
		party.Lock()
		gone := party.ExpiredMembers(now)
		for _, m := range gone {
			party.Remove(m.MemberId)
		}
		expired := party.IsExpired(now)
		party.Unlock()

		if expired {
			over = append(over, party)
			continue
		}
		if len(gone) > 0 {
			changed = append(changed, party)
		}
	}
	if len(over) > 0 {
		s.mu.Lock()
		for _, party := range over {
			if s.parties[party.Code] == party {
				delete(s.parties, party.Code)
			}
		}
		s.mu.Unlock()
	}
	return changed
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func randomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
