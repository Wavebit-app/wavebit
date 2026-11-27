// Command wavebit-stress loads a party server the way real parties do, with
// some bad actors mixed in, and reports how quickly everyone heard everything.
//
//	go run ./cmd/wavebit-stress -server http://127.0.0.1:8099 -parties 200 -members 5 -duration 60s
//
// Every party has a host and members on their own sockets. Each device pings
// every 5 s, as the apps do; the host seeks every few seconds and members
// react. Timings are measured in this process, from the moment a frame is
// sent to the moment each device reads the result.
//
// Bad actors, per -abuse: sockets that never read (the server must drop them
// without slowing anyone else), a member flooding frames, a client guessing
// codes, and a member that leaves but keeps its socket. Run the server with
// limits raised for one address (every client here is 127.0.0.1), for
// example JAM_CREATE_RATE_PER_MINUTE=1000000 JAM_MAX_PARTIES_PER_CLIENT=0
// JAM_LOOKUP_RATE_PER_MINUTE=1000000 JAM_MAX_PARTIES=5000.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

var (
	server   = flag.String("server", "http://127.0.0.1:8099", "party server")
	parties  = flag.Int("parties", 100, "parties")
	members  = flag.Int("members", 5, "devices per party, the host included")
	duration = flag.Duration("duration", 30*time.Second, "how long to run")
	seekGap  = flag.Duration("seek", 3*time.Second, "how often each host seeks")
	reactGap = flag.Duration("react", 2*time.Second, "how often each member reacts")
	abuse    = flag.Bool("abuse", true, "add slow readers, flooders, a code guesser and ghosts")
	strict   = flag.Bool("strict", false, "exit 1 on any failure, for CI")
	maxP99   = flag.Duration("max-p99", 2*time.Second, "with -strict, the slowest p99 allowed")
)

// Outcomes the strict check looks at.
var (
	flooderCut, ghostClosed, guesserHeld atomic.Bool
)

type samples struct {
	mu sync.Mutex
	v  []time.Duration
}

func (s *samples) add(d time.Duration) {
	s.mu.Lock()
	s.v = append(s.v, d)
	s.mu.Unlock()
}

func (s *samples) p99() (time.Duration, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.v) == 0 {
		return 0, 0
	}
	v := append([]time.Duration(nil), s.v...)
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	return v[int(float64(len(v)-1)*.99)], len(v)
}

func (s *samples) report(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.v) == 0 {
		fmt.Printf("%-26s none\n", name)
		return
	}
	sort.Slice(s.v, func(i, j int) bool { return s.v[i] < s.v[j] })
	q := func(p float64) time.Duration { return s.v[int(float64(len(s.v)-1)*p)] }
	fmt.Printf("%-26s n=%-7d p50=%-9v p95=%-9v p99=%-9v max=%v\n", name, len(s.v),
		q(.5).Round(10*time.Microsecond), q(.95).Round(10*time.Microsecond), q(.99).Round(10*time.Microsecond), s.v[len(s.v)-1].Round(10*time.Microsecond))
}

var (
	pongs, fanout, reactions samples
	errorsSeen, closedEarly  atomic.Int64
	framesIn, rateLimited    atomic.Int64
	createFailed, joinFailed atomic.Int64
	httpClient               = &http.Client{Timeout: 15 * time.Second}
)

func post(path string, body interface{}, token string) (int, map[string]interface{}) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", *server+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return 0, nil
	}
	defer res.Body.Close()
	var out map[string]interface{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func identity(party, n int) map[string]interface{} {
	return map[string]interface{}{
		"userId":      fmt.Sprintf("u-%d-%d", party, n),
		"deviceId":    fmt.Sprintf("d-%d-%d", party, n),
		"displayName": fmt.Sprintf("Listener %d", n),
		"features":    []string{"reactions"},
	}
}

func dial(code, token string) (*websocket.Conn, error) {
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(*server, "http")+"/ws/parties/"+code, h)
	return ws, err
}

// party runs one party until stop closes.
type party struct {
	code   string
	mu     sync.Mutex
	seekAt map[int64]time.Time // positionMs → when the host sent it
	reacts map[string]time.Time
}

func (p *party) device(ws *websocket.Conn, host bool, memberID string, stop <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	var writeMu sync.Mutex
	send := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return ws.WriteJSON(v)
	}
	done := make(chan struct{})
	// Each seek is timed once per device: the server restates where a party
	// is every few seconds, and a repeat isn't a delivery.
	timed := map[int64]bool{}
	go func() {
		defer close(done)
		for {
			var f map[string]interface{}
			if err := ws.ReadJSON(&f); err != nil {
				select {
				case <-stop:
				default:
					closedEarly.Add(1)
				}
				return
			}
			framesIn.Add(1)
			now := time.Now()
			switch f["type"] {
			case "pong":
				if sent, ok := f["clientMs"].(float64); ok {
					pongs.add(now.Sub(time.UnixMicro(int64(sent))))
				}
			case "state":
				pb, _ := f["playback"].(map[string]interface{})
				if pos, ok := pb["positionMs"].(float64); ok {
					p.mu.Lock()
					at, seen := p.seekAt[int64(pos)]
					p.mu.Unlock()
					if seen && !host && !timed[int64(pos)] {
						timed[int64(pos)] = true
						fanout.add(now.Sub(at))
					}
				}
			case "reaction":
				from, _ := f["memberId"].(string)
				p.mu.Lock()
				at, seen := p.reacts[from]
				p.mu.Unlock()
				if seen && from != memberID {
					reactions.add(now.Sub(at))
				}
			case "error":
				if f["error"] == "rate_limited" {
					rateLimited.Add(1)
				} else {
					errorsSeen.Add(1)
				}
			}
		}
	}()
	ping := time.NewTicker(5 * time.Second)
	defer ping.Stop()
	action := time.NewTicker(map[bool]time.Duration{true: *seekGap, false: *reactGap}[host])
	defer action.Stop()
	_ = send(map[string]interface{}{"type": "ping", "clientMs": float64(time.Now().UnixMicro())})
	pos := int64(0)
	for {
		select {
		case <-stop:
			_ = ws.Close()
			<-done
			return
		case <-done:
			return
		case <-ping.C:
			_ = send(map[string]interface{}{"type": "ping", "clientMs": float64(time.Now().UnixMicro())})
		case <-action.C:
			if host {
				pos += 1000
				p.mu.Lock()
				p.seekAt[pos] = time.Now()
				p.mu.Unlock()
				_ = send(map[string]interface{}{"type": "control", "action": "seek", "positionMs": pos})
			} else {
				p.mu.Lock()
				p.reacts[memberID] = time.Now()
				p.mu.Unlock()
				_ = send(map[string]interface{}{"type": "react", "reaction": "fire"})
			}
		}
	}
}

func main() {
	flag.Parse()
	stop := make(chan struct{})
	var wg sync.WaitGroup
	started := time.Now()
	var sockets atomic.Int64
	all := make([]*party, 0, *parties)

	for i := 0; i < *parties; i++ {
		status, made := post("/api/parties", identity(i, 0), "")
		if status != http.StatusCreated {
			createFailed.Add(1)
			continue
		}
		p := &party{code: made["code"].(string), seekAt: map[int64]time.Time{}, reacts: map[string]time.Time{}}
		all = append(all, p)
		tokens := []string{made["token"].(string)}
		ids := []string{made["you"].(map[string]interface{})["memberId"].(string)}
		for n := 1; n < *members; n++ {
			status, joined := post("/api/parties/"+p.code+"/join", identity(i, n), "")
			if status != http.StatusOK {
				joinFailed.Add(1)
				continue
			}
			tokens = append(tokens, joined["token"].(string))
			ids = append(ids, joined["you"].(map[string]interface{})["memberId"].(string))
		}
		for n, token := range tokens {
			ws, err := dial(p.code, token)
			if err != nil {
				closedEarly.Add(1)
				continue
			}
			sockets.Add(1)
			wg.Add(1)
			go p.device(ws, n == 0, ids[n], stop, &wg)
		}
	}
	fmt.Printf("set up %d parties, %d sockets in %v (create failed %d, join failed %d)\n",
		len(all), sockets.Load(), time.Since(started).Round(time.Millisecond), createFailed.Load(), joinFailed.Load())

	abuseLog := func() []string { return nil }
	if *abuse && len(all) > 0 {
		abuseLog = runAbuse(all, stop)
	}

	time.Sleep(*duration)
	close(stop)
	wg.Wait()

	fmt.Printf("\nafter %v:\n", *duration)
	pongs.report("ping round trip")
	fanout.report("seek reaches members")
	reactions.report("reaction reaches others")
	fmt.Printf("frames read %d, rate limited %d, other errors %d, sockets closed early %d\n",
		framesIn.Load(), rateLimited.Load(), errorsSeen.Load(), closedEarly.Load())
	time.Sleep(200 * time.Millisecond)
	for _, line := range abuseLog() {
		fmt.Println(line)
	}
	_ = os.Stdout.Sync()
	if *strict {
		os.Exit(check(len(all), int(sockets.Load())))
	}
}

// check says what failed, for -strict, and returns the exit code.
func check(made, sockets int) int {
	var failed []string
	if made != *parties || createFailed.Load() > 0 || joinFailed.Load() > 0 {
		failed = append(failed, fmt.Sprintf("only %d of %d parties set up (%d joins refused)", made, *parties, joinFailed.Load()))
	}
	if sockets != made**members {
		failed = append(failed, fmt.Sprintf("%d sockets instead of %d", sockets, made**members))
	}
	if closedEarly.Load() > 0 || errorsSeen.Load() > 0 {
		failed = append(failed, fmt.Sprintf("%d sockets closed early, %d error frames", closedEarly.Load(), errorsSeen.Load()))
	}
	for name, s := range map[string]*samples{"ping": &pongs, "seek": &fanout, "reaction": &reactions} {
		p99, n := s.p99()
		if n == 0 {
			failed = append(failed, name+": nothing measured")
		} else if p99 > *maxP99 {
			failed = append(failed, fmt.Sprintf("%s p99 %v over %v", name, p99, *maxP99))
		}
	}
	if *abuse {
		if !flooderCut.Load() {
			failed = append(failed, "the flooder wasn't cut off")
		}
		if !ghostClosed.Load() {
			failed = append(failed, "a member who left kept its socket")
		}
		if !guesserHeld.Load() {
			failed = append(failed, "the code guesser wasn't held back")
		}
	}
	if len(failed) == 0 {
		fmt.Println("\nstrict: passed")
		return 0
	}
	fmt.Println("\nstrict: FAILED")
	for _, f := range failed {
		fmt.Println("  " + f)
	}
	return 1
}

// runAbuse starts the bad actors and returns what to report about them.
func runAbuse(all []*party, stop <-chan struct{}) func() []string {
	var lines []string
	var mu sync.Mutex
	say := func(format string, args ...interface{}) {
		mu.Lock()
		lines = append(lines, fmt.Sprintf(format, args...))
		mu.Unlock()
	}

	// Slow readers: join a few parties and never read. Big queues make the
	// server write to them, which must not slow the others.
	for i := 0; i < 5 && i < len(all); i++ {
		p := all[i]
		status, joined := post("/api/parties/"+p.code+"/join", identity(100000+i, 0), "")
		if status != http.StatusOK {
			say("slow reader %d: join refused (%d), party full", i, status)
			continue
		}
		ws, err := dial(p.code, joined["token"].(string))
		if err != nil {
			continue
		}
		go func(ws *websocket.Conn, i int) {
			<-stop
			_ = ws.Close()
		}(ws, i)
		say("slow reader %d: on party %s, never reads", i, p.code)
	}

	// A flooder: a member sending frames as fast as it can.
	go func() {
		p := all[len(all)-1]
		status, joined := post("/api/parties/"+p.code+"/join", identity(200000, 0), "")
		if status != http.StatusOK {
			say("flooder: join refused (%d)", status)
			return
		}
		ws, err := dial(p.code, joined["token"].(string))
		if err != nil {
			return
		}
		go func() {
			for {
				if _, _, err := ws.ReadMessage(); err != nil {
					return
				}
			}
		}()
		sent := 0
		start := time.Now()
		for {
			if err := ws.WriteJSON(map[string]interface{}{"type": "react", "reaction": "fire"}); err != nil {
				flooderCut.Store(true)
				say("flooder: cut off after %d frames in %v", sent, time.Since(start).Round(time.Millisecond))
				return
			}
			sent++
			select {
			case <-stop:
				say("flooder: still connected after %d frames", sent)
				return
			default:
			}
		}
	}()

	// A code guesser: how far does it get?
	go func() {
		got := map[int]int{}
		for i := 0; i < 400; i++ {
			res, err := httpClient.Get(fmt.Sprintf("%s/api/parties/Z%05d/preview", *server, i))
			if err != nil {
				continue
			}
			res.Body.Close()
			got[res.StatusCode]++
		}
		guesserHeld.Store(got[http.StatusTooManyRequests] > 0 && got[http.StatusOK] == 0)
		say("code guesser, 400 tries: %v", got)
	}()

	// A ghost: leaves, then keeps sending controls on its old socket.
	go func() {
		p := all[len(all)/2]
		status, joined := post("/api/parties/"+p.code+"/join", identity(300000, 0), "")
		if status != http.StatusOK {
			say("ghost: join refused (%d)", status)
			return
		}
		token := joined["token"].(string)
		ws, err := dial(p.code, token)
		if err != nil {
			return
		}
		post("/api/parties/"+p.code+"/leave", nil, token)
		_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				break
			}
		}
		err = ws.WriteJSON(map[string]interface{}{"type": "control", "action": "pause"})
		_, _, readErr := ws.ReadMessage()
		ghostClosed.Store(readErr != nil || err != nil)
		say("ghost: socket closed after leaving: %v", readErr != nil || err != nil)
	}()
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), lines...)
	}
}
