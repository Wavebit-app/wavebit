package protocol

import (
	"strings"
	"testing"
)

func validRequest() JoinRequest {
	max := 5
	autoplay := true
	return JoinRequest{
		UserId:          "u_alice",
		DeviceId:        "d_alice",
		DisplayName:     "Alice",
		MaxMembers:      &max,
		AutoplayEnabled: &autoplay,
	}
}

func TestValidateAcceptsValidRequest(t *testing.T) {
	req := validRequest()
	avatar := "https://lh3.googleusercontent.com/a/abc"
	req.AvatarUrl = &avatar
	if err := req.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
	if req.AvatarUrl == nil {
		t.Fatalf("a Google picture should be kept")
	}
}

func TestValidateRejectsMissingIdentity(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*JoinRequest)
	}{
		{"empty userId", func(r *JoinRequest) { r.UserId = "   " }},
		{"empty deviceId", func(r *JoinRequest) { r.DeviceId = "" }},
		{"empty displayName", func(r *JoinRequest) { r.DisplayName = " " }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := validRequest()
			c.mutate(&req)
			if err := req.Validate(); err == nil {
				t.Fatalf("Validate() = nil, want error")
			}
		})
	}
}

func TestValidateRejectsOversizeFields(t *testing.T) {
	req := validRequest()
	req.UserId = strings.Repeat("u", 129)
	if err := req.Validate(); err == nil {
		t.Errorf("oversize userId accepted")
	}

	req = validRequest()
	req.DeviceId = strings.Repeat("d", 129)
	if err := req.Validate(); err == nil {
		t.Errorf("oversize deviceId accepted")
	}

	req = validRequest()
	req.DisplayName = strings.Repeat("n", 81)
	if err := req.Validate(); err == nil {
		t.Errorf("oversize displayName accepted")
	}

	req = validRequest()
	avatar := "https://lh3.googleusercontent.com/" + strings.Repeat("a", 1000)
	req.AvatarUrl = &avatar
	if err := req.Validate(); err != nil || req.AvatarUrl != nil {
		t.Errorf("an oversize avatarUrl should be dropped, got %v, %v", err, req.AvatarUrl)
	}
}

func TestValidateAvatarUrl(t *testing.T) {
	req := validRequest()
	blank := "   "
	req.AvatarUrl = &blank
	if err := req.Validate(); err != nil {
		t.Fatalf("blank avatarUrl should be dropped, got %v", err)
	}
	if req.AvatarUrl != nil {
		t.Errorf("blank avatarUrl should become nil")
	}

	req = validRequest()
	for _, bad := range []string{"ftp://example.com/a.png", "http://lh3.googleusercontent.com/a", "https://tracker.example/a.png"} {
		req = validRequest()
		req.AvatarUrl = &bad
		if err := req.Validate(); err != nil || req.AvatarUrl != nil {
			t.Errorf("%s should be dropped without refusing the join, got %v, %v", bad, err, req.AvatarUrl)
		}
	}
}

func TestValidateMaxMembers(t *testing.T) {
	for _, n := range []int{2, 5, 10} {
		req := validRequest()
		req.MaxMembers = &n
		if err := req.Validate(); err != nil {
			t.Errorf("MaxMembers=%d rejected: %v", n, err)
		}
	}
	for _, n := range []int{1, 11} {
		req := validRequest()
		req.MaxMembers = &n
		if err := req.Validate(); err == nil {
			t.Errorf("MaxMembers=%d accepted, want error", n)
		}
	}
}

func TestValidateTrimsWhitespace(t *testing.T) {
	req := validRequest()
	req.UserId = "  u_alice "
	req.DisplayName = " Alice "
	if err := req.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
	if req.UserId != "u_alice" || req.DisplayName != "Alice" {
		t.Errorf("fields not trimmed: %+v", req)
	}
}

func TestValidateCleansTheName(t *testing.T) {
	req := validRequest()
	req.DisplayName = "Ma\u202Eya"
	if err := req.Validate(); err != nil || req.DisplayName != "Maya" {
		t.Fatalf("got %q, %v", req.DisplayName, err)
	}
	req = validRequest()
	req.DisplayName = "\u200B\u200B"
	if err := req.Validate(); err == nil {
		t.Fatalf("a name of only invisible characters was accepted")
	}
}

func TestReactionsAreTheEight(t *testing.T) {
	want := []string{"heart", "fire", "laugh", "wow", "sad", "clap", "party", "dance"}
	if len(Reactions) != len(want) {
		t.Fatalf("got %d reactions", len(Reactions))
	}
	for _, id := range want {
		if !Reactions[id] {
			t.Errorf("%s missing", id)
		}
	}
}

func TestFeaturesAreCapped(t *testing.T) {
	req := validRequest()
	req.Features = []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "reactions"}
	_ = req.Validate()
	if len(req.Features) != 8 || req.Wants("reactions") {
		t.Fatalf("features not capped: %v", req.Features)
	}
}
