package game_test

import (
	"testing"

	"github.com/IntermezzoSoftware/Masterboard/internal/game"
)

func TestCategorizeTimeControl(t *testing.T) {
	cases := []struct {
		tc   string
		want string
	}{
		{"60+0", "bullet"},
		{"120+1", "bullet"},
		{"179+0", "bullet"},
		{"180+0", "blitz"},
		{"300+3", "blitz"},
		{"599+0", "blitz"},
		{"600+0", "rapid"},
		{"900+10", "rapid"},
		{"1799+0", "rapid"},
		{"1800+0", "classical"},
		{"3600+30", "classical"},
		{"-", "other"},
		{"", "other"},
		{"∞", "other"},
	}
	for _, c := range cases {
		got := game.CategorizeTimeControl(c.tc)
		if got != c.want {
			t.Errorf("CategorizeTimeControl(%q) = %q, want %q", c.tc, got, c.want)
		}
	}
}

func TestParseTimeControlSecs(t *testing.T) {
	if got := game.ParseTimeControlSecs("600+5"); got != 600 {
		t.Errorf("ParseTimeControlSecs(\"600+5\") = %d, want 600", got)
	}
	if got := game.ParseTimeControlSecs("300"); got != 300 {
		t.Errorf("ParseTimeControlSecs(\"300\") = %d, want 300", got)
	}
	if got := game.ParseTimeControlSecs("-"); got != 0 {
		t.Errorf("ParseTimeControlSecs(\"-\") = %d, want 0", got)
	}
}
