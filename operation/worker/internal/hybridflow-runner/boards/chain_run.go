package boards

import (
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

// chainFrom is the run's flow nodes as a panel draws them: what it has played, in the order it
// played them, then the card it is on, then what lies ahead of that one along the `onSuccess`
// links — fanning out over a Gateway's branches, breadth-first, so every branch reads as ahead.
//
// **The tail is a forecast and the head is a record.** What is ahead is read off the board as it
// stands right now and may perfectly well be rewritten before the run gets there — a chain is
// edited under a run like everything else on a board — which is exactly why it is worked out afresh
// at every step rather than fixed when the run starts.
//
// A card the board no longer holds keeps its place with an empty status: it was played, and a trail
// that quietly dropped it would be a chain run claiming it did less than it did.
func ChainFrom(board *BoardContent, trail []string, current string) []runstate.AgentChainRunFlowNodeDto {
	seen := map[string]bool{}
	var ids []string
	add := func(id string) bool {
		if id == "" || seen[id] {
			return false
		}
		seen[id] = true
		ids = append(ids, id)
		return true
	}
	for _, id := range trail {
		add(id)
	}
	add(current)
	queue := []string{current}
	for len(queue) > 0 {
		at := queue[0]
		queue = queue[1:]
		flowNode := board.FlowNode(at)
		if flowNode == nil {
			continue
		}
		for _, id := range successorIDs(*flowNode) {
			if add(id) {
				queue = append(queue, id)
			}
		}
	}

	out := make([]runstate.AgentChainRunFlowNodeDto, 0, len(ids))
	for _, id := range ids {
		entry := runstate.AgentChainRunFlowNodeDto{ID: id}
		if flowNode := board.FlowNode(id); flowNode != nil {
			entry.Title = flowNode.Title
			// A card says `ready` by saying nothing, which is the card's shorthand and not a
			// thing every reader of this list should have to know.
			entry.Status = flowNode.Status
			if entry.Status == "" {
				entry.Status = FlowNodeStatusReady
			}
		}
		out = append(out, entry)
	}
	return out
}
