package clean

import "testing"

func TestTextRemovesWhatChangesHowTextReads(t *testing.T) {
	cases := map[string]string{
		"Maya":                         "Maya",
		"  Maya   Rao  ":               "Maya Rao",
		"Ma‮ya":                        "Maya", // right-to-left override
		"Ma​ya":                        "Maya", // zero-width space
		"Host rejoin at evil":          "Host rejoin at evil",
		"line\nbreak\ttab":             "line break tab",
		"\x00\x07bell":                 "bell",
		"❤️ fire 🔥":                    "❤️ fire 🔥",
		string([]byte{0xff, 'o', 'k'}): "ok",
		"👨\u200D👩\u200D👧":              "👨\u200D👩\u200D👧",
	}
	for in, want := range cases {
		if got := Text(in, 80); got != want {
			t.Errorf("Text(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTextCountsCharactersNotBytes(t *testing.T) {
	got := Text("ééééé", 3)
	if got != "ééé" {
		t.Fatalf("got %q", got)
	}
	if Text("ab cd", 3) != "ab" {
		t.Fatalf("a trailing space should not be kept at the limit, got %q", Text("ab cd", 3))
	}
}

func TestImageURLKeepsOnlyTheAppsPictureHosts(t *testing.T) {
	ok := []string{
		"https://lh3.googleusercontent.com/a/abc=s96-c",
		"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
		"https://i.scdn.co/image/ab67616d0000b273",
		"https://yt3.ggpht.com/x",
	}
	for _, u := range ok {
		if ImageURL(u) == nil {
			t.Errorf("%s should be kept", u)
		}
	}
	bad := []string{
		"http://lh3.googleusercontent.com/a",
		"https://tracker.example/pixel.png",
		"https://googleusercontent.com.evil.example/a",
		"https://evilgoogleusercontent.com/a",
		"https://user@lh3.googleusercontent.com/a",
		"https://lh3.googleusercontent.com:8443/a",
		"javascript:alert(1)",
		"",
	}
	for _, u := range bad {
		if ImageURL(u) != nil {
			t.Errorf("%s should be dropped", u)
		}
	}
}

func TestVideoID(t *testing.T) {
	if !VideoID("dQw4w9WgXcQ") || !VideoID("a-b_C9") {
		t.Fatal("real ids refused")
	}
	for _, id := range []string{"", "../../x", "a b", "<script>", string(make([]byte, 65))} {
		if VideoID(id) {
			t.Errorf("%q accepted", id)
		}
	}
}
