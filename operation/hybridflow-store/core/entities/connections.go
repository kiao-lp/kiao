package entities

// Successors returns the stored connections, independently of the card's type.
func (n FlowNode) Successors() []string {
	ids := append([]string{}, n.Nexts...)
	if n.Next != "" {
		ids = append(ids, n.Next)
	}
	return ids
}

// ValidateConnectionChanges checks added links and type changes. Existing invalid
// links may be removed without requiring an unrelated legacy chain to be repaired.
func ValidateConnectionChanges(held []FlowNode, changes []FlowNode) error {
	before, after := map[string]FlowNode{}, map[string]FlowNode{}
	for _, n := range held {
		before[n.ID], after[n.ID] = n, n
	}
	for _, n := range changes {
		after[n.ID] = n
	}
	incoming := map[string]int{}
	for _, n := range after {
		for _, next := range n.Successors() {
			incoming[next]++
		}
	}
	for _, n := range changes {
		previous, existed := before[n.ID]
		if (!existed || previous.Type != n.Type) && n.Type.IsDisplay() && incoming[n.ID] > 0 {
			return Invalidf("card %q cannot have a predecessor", n.Title)
		}
		if (!existed || previous.Type != n.Type) && n.Type != FlowNodeGateway && incoming[n.ID] > 1 {
			return Invalidf("card %q can have only one predecessor; use a gateway to join branches", n.Title)
		}
		nexts := n.Successors()
		if (!n.Type.Chains() && len(nexts) > 0) || (n.Type != FlowNodeGateway && len(nexts) > 1) {
			return Invalidf("card %q has successors its type does not allow", n.Title)
		}
		old := map[string]bool{}
		for _, next := range previous.Successors() {
			old[next] = true
		}
		for _, next := range nexts {
			if old[next] {
				continue
			}
			target, ok := after[next]
			if !ok {
				return NotFoundf("successor %s", next)
			}
			if next == n.ID || target.BoardID != n.BoardID || target.Type.IsDisplay() {
				return Invalidf("card %q cannot be chained to %q", n.Title, target.Title)
			}
			if target.Type != FlowNodeGateway && incoming[next] > 1 {
				return Invalidf("card %q can have only one predecessor; use a gateway to join branches", target.Title)
			}
		}
	}
	return nil
}
