package solution

// 1. Two Sum — https://leetcode.com/problems/two-sum/
//
// Whiteboard trace:
//
//	title: 1. Two Sum (target = 9)
//	array nums = [2, 7, 11, 15]
//	variable target = 9
//	dict seen
//	pointer i at nums[0]
//	x = nums[i]
//	need = target - x
//	need 7 is not in seen
//	put x -> i into seen
//	move i to 1
//	x = nums[i]
//	need = target - x
//	need 2 is in seen
//	return [seen[need], i]
func twoSum(nums []int, target int) []int {
	seen := map[int]int{}
	for i, x := range nums {
		if j, ok := seen[target-x]; ok {
			return []int{j, i}
		}
		seen[x] = i
	}
	return nil
}
