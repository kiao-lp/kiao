package services

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"kiao/hybridflow-store/core/entities"
)

// CopyWorkflow reads all members, including flow nodes hidden on the canvas.
func (t *FlowNodes) CopyWorkflow(ctx context.Context, boardID, id string) (*entities.Workflow, []entities.FlowNode, error) {
	workflow, err := t.workflows.FindWorkflow(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if workflow.BoardID != boardID {
		return nil, nil, entities.NotFoundf("workflow %s on this board", id)
	}
	nodes, err := t.repo.ListFlowNodes(ctx, boardID)
	if err != nil {
		return nil, nil, err
	}
	return workflow, slices.DeleteFunc(nodes, func(node entities.FlowNode) bool {
		return node.WorkflowID != id
	}), nil
}

// PasteWorkflow makes an independent group. Source flow node ids identify references within the
// clipboard, so a snapshot can also be pasted when its source board or store is unavailable.
func (t *FlowNodes) PasteWorkflow(ctx context.Context, boardID string, group entities.Workflow, source []NewFlowNodeRequest, at *entities.Spot, actor string) (entities.Workflow, []entities.FlowNode, error) {
	if group.Values != "" {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(group.Values), &fields); err != nil || fields == nil {
			return entities.Workflow{}, nil, entities.Invalidf("workflow values must be a JSON object")
		}
		if err := entities.ValidateWorkflowValues(fields); err != nil {
			return entities.Workflow{}, nil, err
		}
	}
	folder, err := readWorkflowFolder(group.WorkflowFolder)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	files, err := readWorkflowFiles(group.Files)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	minted, err := t.pastedFlowNodeIDs(source)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	requests := make([]NewFlowNodeRequest, 0, len(source))
	for _, node := range source {
		node = pastedFlowNode(node, minted)
		node.Settings, err = t.pastedSettings(ctx, node.Settings)
		if err != nil {
			return entities.Workflow{}, nil, err
		}
		requests = append(requests, node)
	}
	nodes, err := t.prepareFlowNodes(ctx, boardID, requests)
	if err != nil {
		return entities.Workflow{}, nil, err
	}
	if err := entities.ValidateConnectionChanges(nil, nodes); err != nil {
		return entities.Workflow{}, nil, err
	}
	if len(nodes) > 0 {
		if err := t.placePastedWorkflow(ctx, boardID, nodes, at); err != nil {
			return entities.Workflow{}, nil, err
		}
	}
	now := t.clock.Now()
	workflow := entities.Workflow{
		ID: t.ids.NewID(), BoardID: boardID, Name: strings.TrimSpace(group.Name), Values: group.Values,
		WorkflowFolder: folder, Files: files,
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	for i := range nodes {
		nodes[i].WorkflowID = workflow.ID
	}
	if err := t.workflows.CreateWorkflowWithFlowNodes(ctx, &workflow, flowNodePointers(nodes), actor); err != nil {
		return entities.Workflow{}, nil, err
	}
	return workflow, nodes, nil
}

func (t *FlowNodes) pastedFlowNodeIDs(source []NewFlowNodeRequest) (map[string]string, error) {
	oldIDs := make([]string, 0, len(source))
	newIDs := make([]string, 0, len(source))
	for _, node := range source {
		id := strings.TrimSpace(node.ID)
		if id == "" {
			return nil, entities.Invalidf("every workflow clipboard flow node needs a source id")
		}
		oldIDs = append(oldIDs, id)
		newIDs = append(newIDs, t.ids.NewID())
	}
	// Gateway joins read predecessor outputs in board order, which is sorted by flow node id.
	slices.Sort(oldIDs)
	slices.Sort(newIDs)
	minted := make(map[string]string, len(oldIDs))
	for i, id := range oldIDs {
		if _, seen := minted[id]; seen {
			return nil, entities.Invalidf("duplicate workflow clipboard flow node id %q", id)
		}
		minted[id] = newIDs[i]
	}
	return minted, nil
}

func pastedFlowNode(node NewFlowNodeRequest, minted map[string]string) NewFlowNodeRequest {
	remap := func(id string) string { return minted[strings.TrimSpace(id)] }
	node.Type = string(entities.ReadFlowNodeType(node.Type, node.Settings))
	node.ID = remap(node.ID)
	node.Next = remap(node.Next)
	// A copied limiter keeps its "No passes left" branch only when it keeps its "Passes left" branch.
	branches := node.Nexts
	node.Nexts = nil
	for _, branch := range branches {
		if target := remap(branch); target != "" {
			node.Nexts = append(node.Nexts, target)
		} else if node.Type == string(entities.FlowNodeLimiter) {
			break
		}
	}
	routes := node.Routes
	node.Routes = nil
	for _, route := range routes {
		if target := remap(route.FlowNode); target != "" {
			node.Routes = append(node.Routes, entities.Route{Condition: route.Condition, FlowNode: target})
		}
	}
	if strings.TrimSpace(node.ValueType) != entities.ValueTypeJSONSchema {
		node.ValueType = remap(node.ValueType)
	}
	node.OutputType = remap(node.OutputType)
	node.Criteria = slices.Clone(node.Criteria)
	for i := range node.Criteria {
		node.Criteria[i].ID = ""
	}
	node.Workflow, node.ConversationID, node.RemainingPasses = "", "", nil
	switch entities.ReadFlowNodeStatus(node.Status) {
	case entities.StatusDraft, entities.StatusBlocked:
	default:
		node.Status = string(entities.StatusReady)
	}
	return node
}

func (t *FlowNodes) pastedSettings(ctx context.Context, settings entities.TaskSettings) (entities.TaskSettings, error) {
	if err := t.agentOf(ctx, settings); err != nil {
		if !errors.Is(err, entities.ErrNotFound) {
			return settings, err
		}
		settings.Agent, settings.Harness, settings.ProfileID, settings.Model = "", "", "", ""
	}
	if settings.Runner != "" {
		if _, err := t.runners.FindRunner(ctx, settings.Runner); err != nil {
			if !errors.Is(err, entities.ErrNotFound) {
				return settings, err
			}
			settings.Runner = ""
		}
	}
	return settings, nil
}
