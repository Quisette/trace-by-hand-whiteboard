package solution

// 20. Valid Parentheses — https://leetcode.com/problems/valid-parentheses/
//
// Whiteboard trace:
//
//	title: 20. Valid Parentheses
//	s = "([)]"
//	stack st
//	pointer i at s[0]
//	c = s[i]
//	push c onto st
//	move i to 1
//	c = s[i]
//	push c onto st
//	move i to 2
//	c = s[i]
//	pop "[" from st
//	# ) does not close [
//	return false
func isValid(s string) bool {
	pair := map[byte]byte{')': '(', ']': '[', '}': '{'}
	st := []byte{}
	for i := 0; i < len(s); i++ {
		c := s[i]
		open, closing := pair[c]
		if !closing {
			st = append(st, c)
			continue
		}
		if len(st) == 0 || st[len(st)-1] != open {
			return false
		}
		st = st[:len(st)-1]
	}
	return len(st) == 0
}
