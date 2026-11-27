package listen

import (
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/Wavebit-app/wavebit/server/codes"
	"github.com/Wavebit-app/wavebit/server/config"
)

type invitePageData struct {
	Code     string
	OpenLink template.URL
	IsActive bool
}

// The page a shared https link lands on: it names the code and opens wavebit.
// It says nothing about the party beyond that, and loads nothing.
var inviteTemplate = template.Must(template.New("invite").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Listen together · {{.Code}}</title>
<style>
  :root { color-scheme: light dark; --bg: #eef0f3; --fg: #14161a; --muted: #5b6270; --card: #fff; --accent: #2f5bea; --on: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0b0d; --fg: #f1f1f3; --muted: #a8adb7; --card: #131316; --accent: #7f95ff; --on: #0d1020; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; box-sizing: border-box; }
  main { background: var(--card); border-radius: 16px; padding: 28px; max-width: 380px; width: 100%; display: flex; flex-direction: column; gap: 14px; }
  h1 { margin: 0; font-size: 20px; }
  .code { font: 700 30px/1.1 ui-monospace, Menlo, monospace; letter-spacing: .16em; }
  p { margin: 0; color: var(--muted); }
  a.open { display: block; text-align: center; padding: 12px; border-radius: 10px; background: var(--accent); color: var(--on); font-weight: 600; text-decoration: none; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
{{if .IsActive}}
  <h1>Listen together</h1>
  <div class="code">{{.Code}}</div>
  <a class="open" href="{{.OpenLink}}">Open in wavebit</a>
  <p>wavebit shows who is in the party and waits for you to press Join.</p>
  <p>No wavebit yet? <a href="https://github.com/Wavebit-app/wavebit/releases" rel="noopener noreferrer">Get it here</a>.</p>
{{else}}
  <h1>No party here</h1>
  <p>This code has ended or isn't on this server. Ask for a new invite.</p>
{{end}}
</main>
</body>
</html>`))

func requestOrigin(r *http.Request) string {
	if config.PublicOrigin != "" {
		return config.PublicOrigin
	}
	proto := "http"
	if r.TLS != nil {
		proto = "https"
	}
	if config.IsTrustedProxy(remoteAddr(r)) {
		if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
			proto = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	host := r.Host
	if host == "" {
		host = "localhost"
	}
	return fmt.Sprintf("%s://%s", proto, host)
}

func (s *Server) handleInviteLanding(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")

	code := codes.Normalise(r.PathValue("code"))
	// The same allowance as a join or a preview: a page that says whether a
	// code exists is a guess like any other.
	if !s.lookupLimiter.Allow(requestKey(r)) || s.guessing(r) {
		w.WriteHeader(http.StatusTooManyRequests)
		_ = inviteTemplate.Execute(w, invitePageData{Code: "", IsActive: false})
		return
	}
	if !codes.IsValid(code) || s.store.Find(code) == nil {
		s.missed(r)
		w.WriteHeader(http.StatusNotFound)
		_ = inviteTemplate.Execute(w, invitePageData{Code: code, IsActive: false})
		return
	}
	// The code is checked against the code alphabet and the origin is escaped,
	// so the link is safe to mark as a URL for the template.
	open := fmt.Sprintf("wavebit://party/%s?server=%s", code, url.QueryEscape(requestOrigin(r)))
	w.WriteHeader(http.StatusOK)
	_ = inviteTemplate.Execute(w, invitePageData{Code: code, OpenLink: template.URL(open), IsActive: true})
}
