package solution

import (
	"testing"
)

func TestIsValid(t *testing.T) {
	cases := []struct {
		s    string
		want bool
	}{
		{"([)]", false}, // traced on your whiteboard
		{"()", true},
		{"()[]{}", true},
		{"(]", false},
		{"([)]", false},
		{"{[]}", true},
		{"]", false},
	}
	for _, c := range cases {
		got := isValid(c.s)
		if got != c.want {
			t.Errorf("isValid(%q) = %v, want %v", c.s, got, c.want)
		}
	}
}
