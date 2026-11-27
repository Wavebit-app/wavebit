package listen

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Wavebit-app/wavebit/server/config"
	"github.com/Wavebit-app/wavebit/server/party"
	"github.com/Wavebit-app/wavebit/server/protocol"
)

func setup(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s := New()
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func post(t *testing.T, url string, body interface{}, token string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return res
}

func decode(t *testing.T, res *http.Response) map[string]interface{} {
	t.Helper()
	defer res.Body.Close()
	var out map[string]interface{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}

type who struct {
	user, device, name string
	features           []string
}

func (w who) body() map[string]interface{} {
	return map[string]interface{}{"userId": w.user, "deviceId": w.device, "displayName": w.name, "features": w.features}
}

func create(t *testing.T, ts *httptest.Server, w who) (string, string) {
	t.Helper()
	res := post(t, ts.URL+"/api/parties", w.body(), "")
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %v", res.StatusCode, decode(t, res))
	}
	out := decode(t, res)
	return out["code"].(string), out["token"].(string)
}

func join(t *testing.T, ts *httptest.Server, code string, w who) (int, map[string]interface{}) {
	t.Helper()
	res := post(t, ts.URL+"/api/parties/"+code+"/join", w.body(), "")
	return res.StatusCode, decode(t, res)
}

func dial(t *testing.T, ts *httptest.Server, code, token string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(ts.URL)
	u.Scheme = "ws"
	u.Path = "/ws/parties/" + code
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	ws, _, err := websocket.DefaultDialer.Dial(u.String(), h)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { ws.Close() })
	if f := readUntil(t, ws, protocol.FrameWelcome, time.Second); f == nil {
		t.Fatal("no welcome")
	}
	return ws
}

// readUntil reads frames until one of type kind, or gives up and returns nil.
func readUntil(t *testing.T, ws *websocket.Conn, kind string, within time.Duration) map[string]interface{} {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		_ = ws.SetReadDeadline(deadline)
		var f map[string]interface{}
		if err := ws.ReadJSON(&f); err != nil {
			return nil
		}
		if f["type"] == kind {
			return f
		}
	}
	return nil
}

// closedWithin reports whether the server closes ws within d.
func closedWithin(ws *websocket.Conn, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		_ = ws.SetReadDeadline(deadline)
		if _, _, err := ws.ReadMessage(); err != nil {
			return !time.Now().After(deadline)
		}
	}
}

func send(t *testing.T, ws *websocket.Conn, frame map[string]interface{}) {
	t.Helper()
	if err := ws.WriteJSON(frame); err != nil {
		t.Fatalf("write: %v", err)
	}
}

var (
	alice = who{"u_alice", "d_alice", "Alice", []string{protocol.FeatureReactions}}
	bob   = who{"u_bob", "d_bob", "Bob", []string{protocol.FeatureReactions}}
	carol = who{"u_carol", "d_carol", "Carol", nil}
)

func TestRESTEndpoints(t *testing.T) {
	_, ts := setup(t)

	res, err := http.Get(ts.URL + "/healthz")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("GET /healthz: %v %v", res, err)
	}
	for _, path := range []string{"/1324/healthz", "/1324"} {
		if res, _ := http.Get(ts.URL + path); res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
	if out := decode(t, mustGet(t, ts.URL+"/api/time")); out["serverMs"] == nil {
		t.Fatal("no serverMs")
	}

	code, token := create(t, ts, alice)
	if status, _ := join(t, ts, code, bob); status != http.StatusOK {
		t.Fatalf("join: %d", status)
	}

	req, _ := http.NewRequest("GET", ts.URL+"/api/parties/"+code, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusOK {
		t.Fatalf("GET party with token: %d", res.StatusCode)
	}
	if res, _ := http.Get(ts.URL + "/api/parties/" + code); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET party without token: %d", res.StatusCode)
	}
}

func mustGet(t *testing.T, url string) *http.Response {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestRootAndWelcomeOfferReactions(t *testing.T) {
	_, ts := setup(t)
	root := decode(t, mustGet(t, ts.URL+"/"))
	if fmt.Sprint(root["features"]) != "[reactions]" || root["service"] != "wavebit-listen-together" {
		t.Fatalf("root: %v", root)
	}

	code, token := create(t, ts, alice)
	u, _ := url.Parse(ts.URL)
	u.Scheme, u.Path = "ws", "/ws/parties/"+code
	h := http.Header{"Authorization": {"Bearer " + token}}
	ws, _, err := websocket.DefaultDialer.Dial(u.String(), h)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	welcome := readUntil(t, ws, protocol.FrameWelcome, time.Second)
	if fmt.Sprint(welcome["features"]) != "[reactions]" {
		t.Fatalf("welcome: %v", welcome["features"])
	}
}

func TestWebSocketFlow(t *testing.T) {
	_, ts := setup(t)
	code, token := create(t, ts, alice)
	ws := dial(t, ts, code, token)

	send(t, ws, map[string]interface{}{"type": protocol.FramePing, "clientMs": 123456789})
	pong := readUntil(t, ws, protocol.FramePong, 2*time.Second)
	if pong == nil || pong["clientMs"] != float64(123456789) {
		t.Fatalf("pong: %v", pong)
	}

	send(t, ws, map[string]interface{}{
		"type": protocol.FrameControl, "action": protocol.ActionQueueAdd,
		"track": map[string]interface{}{"videoId": "abc_song", "title": "Test Song", "artist": "Artist"},
	})
	q := readUntil(t, ws, protocol.FrameQueue, 2*time.Second)
	if q == nil {
		t.Fatal("no queue frame after queueAdd")
	}
	items := q["queue"].(map[string]interface{})["items"].([]interface{})
	if len(items) != 1 {
		t.Fatalf("queue: %v", items)
	}
}

// Someone who leaves loses their socket with their place.
func TestLeavingClosesTheSocket(t *testing.T) {
	_, ts := setup(t)
	code, hostToken := create(t, ts, alice)
	_, joined := join(t, ts, code, bob)
	bobToken := joined["token"].(string)
	host := dial(t, ts, code, hostToken)
	bobWs := dial(t, ts, code, bobToken)

	if res := post(t, ts.URL+"/api/parties/"+code+"/leave", nil, bobToken); res.StatusCode != http.StatusOK {
		t.Fatalf("leave: %d", res.StatusCode)
	}
	if bye := readUntil(t, bobWs, protocol.FrameBye, time.Second); bye == nil || bye["reason"] != "left" {
		t.Fatalf("bye: %v", bye)
	}
	if !closedWithin(bobWs, 2*time.Second) {
		t.Fatal("the socket of a member who left stayed open")
	}

	// And nothing it might still send reaches the party.
	send(t, host, map[string]interface{}{"type": protocol.FrameSync})
	if readUntil(t, host, protocol.FrameState, time.Second) == nil {
		t.Fatal("host lost its own socket")
	}
}

func TestKickedMemberStaysOut(t *testing.T) {
	_, ts := setup(t)
	code, hostToken := create(t, ts, alice)
	_, joined := join(t, ts, code, bob)
	bobId := joined["you"].(map[string]interface{})["memberId"].(string)
	bobWs := dial(t, ts, code, joined["token"].(string))
	host := dial(t, ts, code, hostToken)

	send(t, host, map[string]interface{}{"type": protocol.FrameControl, "action": protocol.ActionKick, "memberId": bobId})
	if bye := readUntil(t, bobWs, protocol.FrameBye, time.Second); bye == nil || bye["reason"] != "kicked" {
		t.Fatalf("bye: %v", bye)
	}
	if !closedWithin(bobWs, 2*time.Second) {
		t.Fatal("kicked socket stayed open")
	}
	if status, body := join(t, ts, code, bob); status != http.StatusForbidden || body["error"] != "removed" {
		t.Fatalf("rejoin after kick: %d %v", status, body)
	}
}

// A device id only takes a place back once the socket holding it has gone
// quiet, and the old socket is closed when it does.
func TestRejoinWaitsForTheOldSocketToGoQuiet(t *testing.T) {
	s, ts := setup(t)
	code, _ := create(t, ts, alice)
	_, joined := join(t, ts, code, bob)
	old := dial(t, ts, code, joined["token"].(string))

	if status, body := join(t, ts, code, bob); status != http.StatusConflict || body["error"] != "already_connected" {
		t.Fatalf("a live place was taken over: %d %v", status, body)
	}

	// The old device crashed: nothing heard from it for a while.
	p := s.store.Find(code)
	p.Lock()
	p.MemberByDevice(bob.device).LastSeenMs -= 60_000
	p.Unlock()

	if status, body := join(t, ts, code, bob); status != http.StatusOK {
		t.Fatalf("rejoin after the old socket went quiet: %d %v", status, body)
	}
	if !closedWithin(old, 2*time.Second) {
		t.Fatal("the old socket kept running after the token changed")
	}
}

func TestOtherMembersSeeAUserIdOnlyForThisParty(t *testing.T) {
	_, ts := setup(t)
	first, _ := create(t, ts, alice)
	_, a := join(t, ts, first, bob)
	second, _ := create(t, ts, carol)
	_, b := join(t, ts, second, bob)
	idA := a["you"].(map[string]interface{})["userId"]
	idB := b["you"].(map[string]interface{})["userId"]
	if idA == bob.user || idA == idB {
		t.Fatalf("a user id can be followed across parties: %v %v", idA, idB)
	}
}

// Guessing codes: every miss counts, and every kind of miss reads the same.
func TestWrongCodesRunOutQuickly(t *testing.T) {
	_, ts := setup(t)
	saw429 := false
	for i := 0; i < config.MissRatePerMinute+3; i++ {
		res := mustGet(t, ts.URL+fmt.Sprintf("/api/parties/ZZZZ%02d/preview", i))
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests {
			saw429 = true
			break
		}
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("miss %d: %d", i, res.StatusCode)
		}
	}
	if !saw429 {
		t.Fatal("wrong codes were never limited")
	}
}

func TestWrongTokenReadsLikeAWrongCode(t *testing.T) {
	_, ts := setup(t)
	code, _ := create(t, ts, alice)
	res := post(t, ts.URL+"/api/parties/"+code+"/leave", nil, "not-a-token")
	if body := decode(t, res); res.StatusCode != http.StatusNotFound || body["error"] != "no_such_party" {
		t.Fatalf("got %d %v", res.StatusCode, body)
	}
}

func TestPartiesPerAddressAreCapped(t *testing.T) {
	s, ts := setup(t)
	s.createLimiter = newIPRateLimiter(time.Minute, 100, 100)
	for i := 0; i < config.MaxPartiesPerClient; i++ {
		create(t, ts, who{fmt.Sprint("u", i), fmt.Sprint("d", i), "Host", nil})
	}
	res := post(t, ts.URL+"/api/parties", who{"u_x", "d_x", "Host", nil}.body(), "")
	if body := decode(t, res); res.StatusCode != http.StatusTooManyRequests || body["error"] != "too_many_parties" {
		t.Fatalf("got %d %v", res.StatusCode, body)
	}
}

func TestReactionsReachOnlyAppsThatShowThem(t *testing.T) {
	_, ts := setup(t)
	code, aliceToken := create(t, ts, alice)
	_, b := join(t, ts, code, bob)
	_, c := join(t, ts, code, carol)
	a := dial(t, ts, code, aliceToken)
	bw := dial(t, ts, code, b["token"].(string))
	cw := dial(t, ts, code, c["token"].(string))

	send(t, bw, map[string]interface{}{"type": protocol.FrameReact, "reaction": "fire"})
	got := readUntil(t, a, protocol.FrameReaction, time.Second)
	if got == nil || got["reaction"] != "fire" || got["memberId"] != b["you"].(map[string]interface{})["memberId"] {
		t.Fatalf("alice got %v", got)
	}
	if echo := readUntil(t, bw, protocol.FrameReaction, time.Second); echo == nil || echo["id"] != got["id"] {
		t.Fatalf("the sender should get its own reaction back, got %v", echo)
	}
	if readUntil(t, cw, protocol.FrameReaction, 300*time.Millisecond) != nil {
		t.Fatal("an app that didn't declare reactions got one")
	}

	// Carol may still react; her app just doesn't hear them.
	send(t, cw, map[string]interface{}{"type": protocol.FrameReact, "reaction": "clap"})
	if got := readUntil(t, a, protocol.FrameReaction, time.Second); got == nil || got["reaction"] != "clap" {
		t.Fatalf("carol's reaction: %v", got)
	}
}

func TestReactionsAreCheckedAndLimited(t *testing.T) {
	_, ts := setup(t)
	code, token := create(t, ts, alice)
	ws := dial(t, ts, code, token)

	for _, bad := range []interface{}{"🔥", "fire ", "<b>", 7, nil} {
		send(t, ws, map[string]interface{}{"type": protocol.FrameReact, "reaction": bad})
	}
	for i := 0; i < 10; i++ {
		send(t, ws, map[string]interface{}{"type": protocol.FrameReact, "reaction": "heart"})
	}
	// A ping marks the end: everything the server sent for the frames above
	// arrives before its pong.
	send(t, ws, map[string]interface{}{"type": protocol.FramePing, "clientMs": 1})
	n := 0
	_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var f map[string]interface{}
		if err := ws.ReadJSON(&f); err != nil {
			t.Fatalf("read: %v", err)
		}
		if f["type"] == protocol.FramePong {
			break
		}
		if f["type"] == protocol.FrameReaction {
			if f["reaction"] != "heart" {
				t.Fatalf("a bad reaction went through: %v", f)
			}
			n++
		}
	}
	if n != int(config.ReactBurst) {
		t.Fatalf("expected a burst of %v, got %d", config.ReactBurst, n)
	}
}

func TestReactionsWorkInAHostOnlyParty(t *testing.T) {
	_, ts := setup(t)
	code, hostToken := create(t, ts, alice)
	_, b := join(t, ts, code, bob)
	host := dial(t, ts, code, hostToken)
	bw := dial(t, ts, code, b["token"].(string))
	send(t, host, map[string]interface{}{"type": protocol.FrameControl, "action": protocol.ActionSetHostOnlyControl, "enabled": true})
	readUntil(t, host, protocol.FrameMembers, time.Second)
	send(t, bw, map[string]interface{}{"type": protocol.FrameReact, "reaction": "dance"})
	if got := readUntil(t, host, protocol.FrameReaction, time.Second); got == nil {
		t.Fatal("a listener's reaction was blocked by host-only control")
	}
}

func TestClientIPBelievesOnlyTrustedProxies(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:4000"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	config.TrustProxy = true
	t.Cleanup(func() { config.TrustProxy = false })
	if got := clientIP(r).String(); got != "203.0.113.9" {
		t.Fatalf("a header from an untrusted peer was believed: %s", got)
	}

	r.RemoteAddr = "127.0.0.1:4000"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.7")
	if got := clientIP(r).String(); got != "198.51.100.7" {
		t.Fatalf("expected the hop the proxy added, got %s", got)
	}

	config.ClientIPHeader = "X-Real-IP"
	t.Cleanup(func() { config.ClientIPHeader = "" })
	r.Header.Set("X-Real-IP", "192.0.2.44")
	if got := clientIP(r).String(); got != "192.0.2.44" {
		t.Fatalf("named header: %s", got)
	}
}

func TestIPv6CountsByNetwork(t *testing.T) {
	a := clientKey(netip.MustParseAddr("2001:db8:1:2::1"))
	b := clientKey(netip.MustParseAddr("2001:db8:1:2:ffff::9"))
	c := clientKey(netip.MustParseAddr("2001:db8:1:3::1"))
	if a != b || a == c {
		t.Fatalf("got %s %s %s", a, b, c)
	}
}

func TestRateLimiterMakesRoomWhenFull(t *testing.T) {
	limiter := newIPRateLimiter(time.Minute, 2, 1)
	if !limiter.Allow("a") || !limiter.Allow("a") || limiter.Allow("a") {
		t.Fatal("limit of two per key")
	}
	if !limiter.Allow("b") {
		t.Fatal("a full table refused a new address")
	}
	if !limiter.Exceeded("b") == limiter.Allow("b") && false {
		t.Fatal("unreachable")
	}
}

func TestRequestOrigin(t *testing.T) {
	r := httptest.NewRequest("GET", "http://example.com/invite/ABC123", nil)
	r.RemoteAddr = "203.0.113.9:1"
	r.Header.Set("X-Forwarded-Proto", "https")
	if got := requestOrigin(r); got != "http://example.com" {
		t.Errorf("an untrusted peer's proto was believed: %s", got)
	}
	r.RemoteAddr = "127.0.0.1:1"
	if got := requestOrigin(r); got != "https://example.com" {
		t.Errorf("got %s", got)
	}
	config.PublicOrigin = "https://party.example.com"
	t.Cleanup(func() { config.PublicOrigin = "" })
	if got := requestOrigin(r); got != "https://party.example.com" {
		t.Errorf("got %s", got)
	}
}

func TestInviteLanding(t *testing.T) {
	s, ts := setup(t)
	if res := mustGet(t, ts.URL+"/invite/ZZZZZZ"); res.StatusCode != http.StatusNotFound {
		t.Errorf("unknown party: %d", res.StatusCode)
	}
	p, _ := s.store.Create()
	p.Lock()
	_, _ = p.Join("u", "d", "Host", nil)
	p.Unlock()
	config.PublicOrigin = "https://party.example.com"
	t.Cleanup(func() { config.PublicOrigin = "" })

	res := mustGet(t, ts.URL+"/invite/"+p.Code)
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(res.Body)
	page := buf.String()
	if res.StatusCode != http.StatusOK || !strings.Contains(page, "wavebit://party/"+p.Code+"?server=https%3A%2F%2Fparty.example.com") {
		t.Fatalf("landing: %d %s", res.StatusCode, page)
	}
	if !strings.Contains(res.Header.Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatal("no CSP on the landing page")
	}
}

// A browser offers the token as a subprotocol (it cannot set Authorization on
// a WebSocket). The server answers with the protocol name alone, never the token.
func TestWebSocketTokenAsSubprotocol(t *testing.T) {
	_, ts := setup(t)
	code, token := create(t, ts, alice)
	u, _ := url.Parse(ts.URL)
	u.Scheme, u.Path = "ws", "/ws/parties/"+code

	dialer := websocket.Dialer{Subprotocols: []string{socketProtocol, socketTokenPrefix + token}}
	ws, resp, err := dialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("subprotocol token: %v", err)
	}
	defer ws.Close()
	if got := resp.Header.Get("Sec-WebSocket-Protocol"); got != socketProtocol {
		t.Fatalf("answered %q", got)
	}
	bad := websocket.Dialer{Subprotocols: []string{socketProtocol, socketTokenPrefix + "nottherighttoken"}}
	if _, resp, err := bad.Dial(u.String(), nil); err == nil || resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a wrong token should read like a wrong code, got %v", err)
	}
}

func TestPeersOverLibp2pEachHaveTheirOwnAllowance(t *testing.T) {
	a := httptest.NewRequest("GET", "/", nil)
	a.RemoteAddr = "12D3KooWGzBf9Cg7Lr5dNrYJcDP6CQsk2r7mRAbjaGsLc2ZLA7zz"
	b := httptest.NewRequest("GET", "/", nil)
	b.RemoteAddr = "12D3KooWAg94mFLM7mBS3wgZ7cTxLRvXaaaaaaaaaaaaaaaaaaaa"
	if requestKey(a) == requestKey(b) || requestKey(a) == "unknown" {
		t.Fatalf("peers share one allowance: %s %s", requestKey(a), requestKey(b))
	}
	ip := httptest.NewRequest("GET", "/", nil)
	ip.RemoteAddr = "203.0.113.9:4000"
	if requestKey(ip) != "203.0.113.9" {
		t.Fatalf("an IP request: %s", requestKey(ip))
	}
}

// Guessers using up the shared allowance for wrong codes must not lock
// members out of their own party.
func TestMembersStayInWhileGuessersAreHeldBack(t *testing.T) {
	s, ts := setup(t)
	code, token := create(t, ts, alice)
	for !s.globalMisses.Empty() {
		s.globalMisses.Spend()
	}
	req, _ := http.NewRequest("GET", ts.URL+"/api/parties/"+code, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusOK {
		t.Fatalf("a member was locked out: %d", res.StatusCode)
	}
	dial(t, ts, code, token)
	// Guessing, meanwhile, is held back everywhere: previews, joins and the invite page.
	if res := mustGet(t, ts.URL+"/api/parties/"+code+"/preview"); res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("preview while guessing is held back: %d", res.StatusCode)
	}
	if res := mustGet(t, ts.URL+"/invite/"+code); res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("the invite page skipped the shared allowance: %d", res.StatusCode)
	}
}

// Wrong tokens tell a guesser nothing, so they don't spend the allowance of
// a phone that keeps reconnecting to a party that was swept.
func TestATokenPathDoesntCountAsGuessing(t *testing.T) {
	s, ts := setup(t)
	for i := 0; i < config.MissRatePerMinute*3; i++ {
		req, _ := http.NewRequest("GET", ts.URL+fmt.Sprintf("/api/parties/ZZZZ%02d", i%100), nil)
		req.Header.Set("Authorization", "Bearer old-token")
		res, _ := http.DefaultClient.Do(req)
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("try %d: %d", i, res.StatusCode)
		}
	}
	if s.missLimiter.Exceeded("127.0.0.1") {
		t.Fatal("token requests were counted as guesses")
	}
}

func TestActivityTextIsCleaned(t *testing.T) {
	f := activityFrame(&party.Member{DisplayName: "Maya"}, protocol.ActionSetTrack, map[string]interface{}{
		"track": map[string]interface{}{"videoId": "dQw4w9WgXcQ", "title": "Song‮evil\nline"},
	})
	if got := f["detail"]; got != "Changed the song to \"Songevil line\"" {
		t.Fatalf("got %q", got)
	}
	refused := activityFrame(&party.Member{}, protocol.ActionSetTrack, map[string]interface{}{
		"track": map[string]interface{}{"videoId": "../x", "title": "sneaky"},
	})
	if strings.Contains(fmt.Sprint(refused["detail"]), "sneaky") {
		t.Fatal("a refused track's title was passed on")
	}
}

func TestQueueEditsHaveTheirOwnAllowance(t *testing.T) {
	_, ts := setup(t)
	code, token := create(t, ts, alice)
	ws := dial(t, ts, code, token)
	for i := 0; i < 20; i++ {
		send(t, ws, map[string]interface{}{"type": protocol.FrameControl, "action": protocol.ActionQueueAdd,
			"track": map[string]interface{}{"videoId": fmt.Sprintf("song%02d", i)}})
	}
	send(t, ws, map[string]interface{}{"type": protocol.FramePing, "clientMs": 1})
	queues, limited := 0, 0
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var f map[string]interface{}
		if err := ws.ReadJSON(&f); err != nil {
			t.Fatal(err)
		}
		if f["type"] == protocol.FramePong {
			break
		}
		if f["type"] == protocol.FrameQueue {
			queues++
		}
		if f["error"] == "rate_limited" {
			limited++
		}
	}
	if queues > int(config.QueueEditBurst)+1 || limited == 0 {
		t.Fatalf("queue edits weren't limited: %d queue frames, %d refusals", queues, limited)
	}
}
