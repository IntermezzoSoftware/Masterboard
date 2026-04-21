package updater

import (
	"testing"
)

func TestIsNewer(t *testing.T) {
	cases := []struct {
		candidate, base string
		want            bool
	}{
		{"0.2.0", "0.1.0", true},
		{"0.1.0", "0.1.0", false},
		{"0.1.0", "0.2.0", false},
		{"1.0.0", "0.9.9", true},
		{"0.1.1", "0.1.0", true},
	}
	for _, c := range cases {
		got := isNewer(c.candidate, c.base)
		if got != c.want {
			t.Errorf("isNewer(%q, %q) = %v, want %v", c.candidate, c.base, got, c.want)
		}
	}
}

func TestParseSemver(t *testing.T) {
	v := parseSemver("1.2.3")
	if v != [3]int{1, 2, 3} {
		t.Fatalf("got %v", v)
	}
}
