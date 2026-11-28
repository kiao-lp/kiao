package services

import (
	"context"
	"math"

	"kiao/hybridflow-store/core/entities"
)

const defaultMaxPasses = 1

func initLimiter(node *entities.FlowNode, maximum, remaining *int) error {
	if node.Type != entities.FlowNodeLimiter {
		if maximum != nil || remaining != nil {
			return entities.Invalidf("only a limiter has a pass count")
		}
		return nil
	}
	node.MaxPasses = defaultMaxPasses
	if maximum != nil {
		node.MaxPasses = *maximum
	}
	if err := checkMaxPasses(node.MaxPasses); err != nil {
		return err
	}
	node.RemainingPasses = node.MaxPasses
	if remaining != nil {
		if *remaining < 0 || *remaining > node.MaxPasses {
			return entities.Invalidf("remaining passes must be between zero and the maximum")
		}
		node.RemainingPasses = *remaining
	}
	return nil
}

func checkMaxPasses(maximum int) error {
	if maximum < 0 || maximum > math.MaxInt32 {
		return entities.Invalidf("maximum passes must be between 0 and %d", math.MaxInt32)
	}
	return nil
}

func configureLimiter(node *entities.FlowNode, kind entities.FlowNodeType, patch *entities.FlowNodePatch) error {
	if kind != entities.FlowNodeLimiter {
		if patch.MaxPasses != nil || patch.ResetPasses {
			return entities.Invalidf("only a limiter has a pass count")
		}
		zero := 0
		patch.MaxPasses, patch.RemainingPasses = &zero, &zero
		return nil
	}
	maximum := node.MaxPasses
	entering := node.Type != entities.FlowNodeLimiter
	if entering {
		maximum = defaultMaxPasses
	}
	if patch.MaxPasses != nil {
		maximum = *patch.MaxPasses
	}
	if err := checkMaxPasses(maximum); err != nil {
		return err
	}
	if entering || maximum != node.MaxPasses || patch.ResetPasses {
		patch.MaxPasses, patch.RemainingPasses = &maximum, &maximum
	}
	patch.ResetPasses = false
	return nil
}

// PassLimiter selects from the same revision it completes, so a concurrent pass or edit
// cannot make the chosen successor disagree with the counter written to the flow node.
func (t *FlowNodes) PassLimiter(ctx context.Context, id string, revision int64, output, actor string) (*entities.FlowNode, string, error) {
	node, err := t.repo.FindFlowNode(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if node.Revision != revision {
		return nil, "", entities.Conflictf("flow node %s is at revision %d, not %d", id, node.Revision, revision)
	}
	if node.Type != entities.FlowNodeLimiter || node.Archived {
		return nil, "", entities.Invalidf("a pass needs a live limiter")
	}
	if node.RunID != "" {
		return nil, "", entities.ErrFlowNodeHeld
	}
	if !node.Status.Playable() {
		return nil, "", entities.Invalidf("the flow node stands at %q", node.Status)
	}
	if len(node.Nexts) != 2 {
		return nil, "", entities.Invalidf("a limiter needs two live successors")
	}
	for _, id := range node.Nexts {
		next, err := t.repo.FindFlowNode(ctx, id)
		if err != nil {
			return nil, "", err
		}
		if next.Archived {
			return nil, "", entities.Invalidf("a limiter needs two live successors")
		}
	}
	status := entities.StatusDone
	remaining := node.RemainingPasses
	passesLeftSuccessor, noPassesLeftSuccessor := node.Nexts[0], node.Nexts[1]
	next := noPassesLeftSuccessor
	if remaining > 0 {
		remaining--
		next = passesLeftSuccessor
	}
	patch := entities.FlowNodePatch{Status: &status, RemainingPasses: &remaining, ClearOutput: output == ""}
	if output != "" {
		value, err := entities.ReadValueJSON(output)
		if err != nil {
			return nil, "", err
		}
		patch.Output = &value
	}
	node, err = t.repo.PatchFlowNode(ctx, id, patch, &revision, actor)
	if err != nil {
		return nil, "", err
	}
	return node, next, nil
}
