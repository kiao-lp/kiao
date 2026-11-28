package boards

import "fmt"

func connectionShapeError(kind string, success FlowNodeSuccess) string {
	count := len(success.FlowNodes)
	if success.FlowNode != "" {
		count++
	}
	if (kind == flowNodeTypeShutdown || isDisplay(kind)) && count > 0 {
		return "cannot have a successor"
	}
	if !splits(kind) && count > 1 {
		return "can have only one successor; use a gateway to split branches"
	}
	if kind == FlowNodeTypeLimiter && count > 2 {
		return "can have only two successors"
	}
	return ""
}

// ConnectionError validates the live connected component before a run starts.
func (b *BoardContent) ConnectionError(root string) error {
	nodes := map[string]FlowNode{}
	incoming, outgoing := map[string][]string{}, map[string][]string{}
	for _, node := range b.FlowNodes {
		if !node.Archived {
			nodes[node.ID] = node
		}
	}
	for _, node := range b.FlowNodes {
		if node.Archived {
			continue
		}
		for _, next := range successorIDs(node) {
			if _, ok := nodes[next]; ok {
				outgoing[node.ID] = append(outgoing[node.ID], next)
				incoming[next] = append(incoming[next], node.ID)
			}
		}
	}
	seen := map[string]bool{}
	pending := []string{root}
	for len(pending) > 0 {
		id := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[id] {
			continue
		}
		seen[id] = true
		node, ok := nodes[id]
		if !ok {
			continue
		}
		name := node.Title
		if name == "" {
			name = node.ID
		}
		if node.invalidSuccess != nil {
			return fmt.Errorf("flow node %q %s", name, connectionShapeError(node.Type, *node.invalidSuccess))
		}
		if issue := connectionShapeError(node.Type, node.OnSuccess); issue != "" {
			return fmt.Errorf("flow node %q %s", name, issue)
		}
		if (node.Type == FlowNodeTypeStart || isDisplay(node.Type)) && len(incoming[id]) > 0 {
			return fmt.Errorf("flow node %q cannot have a predecessor", name)
		}
		if !node.IsGateway() && node.Type != FlowNodeTypeExclusiveGateway && len(incoming[id]) > 1 {
			return fmt.Errorf("flow node %q can have only one predecessor; use a gateway to join branches", name)
		}
		for _, next := range outgoing[id] {
			if next == id {
				return fmt.Errorf("flow node %q cannot be chained to itself", name)
			}
		}
		pending = append(pending, outgoing[id]...)
		pending = append(pending, incoming[id]...)
	}
	return nil
}
