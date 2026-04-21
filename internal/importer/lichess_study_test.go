package importer

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const twoChapterPGN = `[Event "Chapter One"]
[Site "https://lichess.org/study/abc12345/ch1id123"]
[Orientation "white"]
[Result "*"]

1. e4 *

[Event "Chapter Two"]
[Site "https://lichess.org/study/abc12345/ch2id456"]
[Orientation "black"]
[Result "*"]

1. d4 *
`

func TestSplitChapterPGNs(t *testing.T) {
	chapters := SplitChapterPGNs(twoChapterPGN)
	if len(chapters) != 2 {
		t.Fatalf("want 2 chapters, got %d", len(chapters))
	}
	if !strings.Contains(chapters[0], "Chapter One") {
		t.Error("first chapter missing 'Chapter One'")
	}
	if !strings.Contains(chapters[1], "Chapter Two") {
		t.Error("second chapter missing 'Chapter Two'")
	}
}

func TestExtractPGNHeader(t *testing.T) {
	pgn := "[Event \"My Study Chapter\"]\n[Orientation \"black\"]\n\n1. e4"
	if got := ExtractPGNHeader(pgn, "Event"); got != "My Study Chapter" {
		t.Errorf("Event: want %q, got %q", "My Study Chapter", got)
	}
	if got := ExtractPGNHeader(pgn, "Orientation"); got != "black" {
		t.Errorf("Orientation: want %q, got %q", "black", got)
	}
	if got := ExtractPGNHeader(pgn, "Missing"); got != "" {
		t.Errorf("Missing: want %q, got %q", "", got)
	}
}

func TestParseStudyMeta(t *testing.T) {
	meta, err := parseStudyMeta("abc12345", twoChapterPGN)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Chapters) != 2 {
		t.Fatalf("want 2 chapters, got %d", len(meta.Chapters))
	}
	// twoChapterPGN uses bare chapter names (no "Study: Chapter" format),
	// so the study name falls back to the full first Event value.
	if meta.Name != "Chapter One" {
		t.Errorf("study name: want %q, got %q", "Chapter One", meta.Name)
	}
	ch1 := meta.Chapters[0]
	if ch1.Name != "Chapter One" {
		t.Errorf("ch1 name: want %q, got %q", "Chapter One", ch1.Name)
	}
	if ch1.ID != "ch1id123" {
		t.Errorf("ch1 id: want %q, got %q", "ch1id123", ch1.ID)
	}
	if ch1.Orientation != "white" {
		t.Errorf("ch1 orientation: want %q, got %q", "white", ch1.Orientation)
	}
	ch2 := meta.Chapters[1]
	if ch2.Orientation != "black" {
		t.Errorf("ch2 orientation: want %q, got %q", "black", ch2.Orientation)
	}
}

func TestParseStudyMeta_StudyNameFromEvent(t *testing.T) {
	pgn := `[Event "My Opening Study: Chapter One"]
[Site "https://lichess.org/study/xyz99999/ch1aaaaa"]
[Orientation "white"]
[Result "*"]

1. e4 *

[Event "My Opening Study: Chapter Two"]
[Site "https://lichess.org/study/xyz99999/ch2bbbbb"]
[Orientation "black"]
[Result "*"]

1. d4 *
`
	meta, err := parseStudyMeta("xyz99999", pgn)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Name != "My Opening Study" {
		t.Errorf("study name: want %q, got %q", "My Opening Study", meta.Name)
	}
	if len(meta.Chapters) != 2 {
		t.Fatalf("want 2 chapters, got %d", len(meta.Chapters))
	}
	if meta.Chapters[0].Name != "My Opening Study: Chapter One" {
		t.Errorf("ch1 name: want %q, got %q", "My Opening Study: Chapter One", meta.Chapters[0].Name)
	}
	if meta.Chapters[1].Name != "My Opening Study: Chapter Two" {
		t.Errorf("ch2 name: want %q, got %q", "My Opening Study: Chapter Two", meta.Chapters[1].Name)
	}
}

func TestLichessStudyGET_Private(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/x-chess-pgn")
		w.Write([]byte(twoChapterPGN))
	}))
	defer srv.Close()

	// Without token — should get private error
	_, priv, err := lichessStudyGET(srv.URL+"/study.pgn", "", 5*time.Second)
	if !priv {
		t.Error("expected private=true for 403 response")
	}
	_ = err

	// With token — should succeed
	body, priv2, err2 := lichessStudyGET(srv.URL+"/study.pgn", "mytoken", 5*time.Second)
	if priv2 || err2 != nil {
		t.Errorf("expected success with token, got priv=%v err=%v", priv2, err2)
	}
	if body == "" {
		t.Error("expected non-empty body with valid token")
	}
}

func TestFetchStudyMeta_ParsesMeta(t *testing.T) {
	// Test parseStudyMeta directly (avoids real HTTP calls)
	meta, err := parseStudyMeta("abc12345", twoChapterPGN)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Chapters) != 2 {
		t.Fatalf("want 2 chapters, got %d", len(meta.Chapters))
	}
}
