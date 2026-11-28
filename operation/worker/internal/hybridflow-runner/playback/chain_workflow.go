package playback

import (
	"encoding/json"
	"fmt"
	"maps"

	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
)

type taskWorkflow struct {
	nodeID string
	update pkgBoards.WorkflowUpdate
}

func (r *ChainRunner) prepareTaskWorkflow(run *ChainRun, node *pkgBoards.FlowNode, workflow *pkgBoards.Workflow, continuing bool) (*pkgBoards.Workflow, error) {
	staged := taskWorkflow{nodeID: node.ID}
	if workflow != nil {
		staged.update.ID = workflow.ID
	}
	body, values, err := pkgBoards.WorkflowAssignments(node.Body)
	if err != nil {
		return nil, err
	}
	node.Body, staged.update.Values = body, values
	if continuing {
		r.Mu.Lock()
		previous := run.workflow
		r.Mu.Unlock()
		if previous.nodeID == node.ID {
			if previous.update.ID != staged.update.ID {
				return nil, fmt.Errorf("the task changed workflows while its turn was paused")
			}
			staged = previous
		}
	}
	workflow, err = withTaskAssignments(workflow, staged.update.Values)
	if err != nil {
		return nil, err
	}

	r.Mu.Lock()
	run.workflow = staged
	r.Mu.Unlock()
	return workflow, nil
}

func withTaskAssignments(workflow *pkgBoards.Workflow, values map[string]json.RawMessage) (*pkgBoards.Workflow, error) {
	if len(values) == 0 {
		return workflow, nil
	}
	if workflow == nil {
		return nil, fmt.Errorf("the task sets workflow values but has no workflow")
	}
	withAssignments := *workflow
	withAssignments.Values = maps.Clone(workflow.Values)
	withAssignments.MergeValues(values)
	return &withAssignments, nil
}

func (r *ChainRunner) exportWorkflow(run *ChainRun, message string) (*pkgBoards.WorkflowUpdate, error) {
	_, values, err := pkgBoards.WorkflowAssignments(message)
	if err != nil {
		return nil, err
	}
	r.Mu.Lock()
	update := run.workflow.update
	r.Mu.Unlock()
	if len(values) > 0 {
		if update.ID == "" {
			return nil, fmt.Errorf("the task sets workflow values but has no workflow")
		}
		if len(update.Values) == 0 {
			update.Values = values
		} else {
			update.Values = maps.Clone(update.Values)
			maps.Copy(update.Values, values)
		}
	}
	if len(update.Values) == 0 {
		return nil, nil
	}
	return &update, nil
}
