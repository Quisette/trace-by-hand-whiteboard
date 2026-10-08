package solution

import (
	"reflect"
	"sort"
	"testing"
)

func TestTwoSum(t *testing.T) {
	cases := []struct {
		nums   []int
		target int
		want   []int
	}{
		{[]int{2, 7, 11, 15}, 9, []int{0, 1}}, // traced on your whiteboard
		{[]int{3, 2, 4}, 6, []int{1, 2}},
		{[]int{3, 3}, 6, []int{0, 1}},
	}
	for _, c := range cases {
		got := twoSum(append([]int(nil), c.nums...), c.target)
		sort.Ints(got)
		want := append([]int(nil), c.want...)
		sort.Ints(want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("twoSum(%v, %d) = %v, want %v", c.nums, c.target, got, c.want)
		}
	}
}
