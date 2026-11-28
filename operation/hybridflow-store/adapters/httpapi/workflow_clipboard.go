package httpapi

import (
	"encoding/json"
	"net/http"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/services"
	"kiao/hybridflow-store/lib/httpx"
)

const workflowClipKind = "kiao-workflow"
const workflowClipVersion = 1

type WorkflowClipDto struct {
	Kind      string               `json:"kind"`
	Version   int                  `json:"version"`
	Workflow  *WorkflowClipDataDto `json:"workflow"`
	FlowNodes []NewFlowNodeDto     `json:"flowNodes"`
}

type WorkflowClipDataDto struct {
	Name           string          `json:"name"`
	Values         json.RawMessage `json:"values,omitempty"`
	WorkflowFolder string          `json:"workflowFolder,omitempty"`
	Files          []string        `json:"files,omitempty"`
}

type PasteWorkflowRequestDto struct {
	Clipboard WorkflowClipDto `json:"clipboard"`
	Spot      *SpotDto        `json:"spot,omitempty"`
}

func (a *API) copyWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	board, err := a.boards.Find(ctx, r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	workflow, nodes, err := a.flowNodes.CopyWorkflow(ctx, board.ID, r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	clip := WorkflowClipDto{
		Kind: workflowClipKind, Version: workflowClipVersion,
		Workflow: &WorkflowClipDataDto{
			Name: workflow.Name, Values: json.RawMessage(workflow.Values),
			WorkflowFolder: workflow.WorkflowFolder, Files: workflow.Files,
		},
		FlowNodes: make([]NewFlowNodeDto, 0, len(nodes)),
	}
	for _, node := range nodes {
		dto := newFlowNodeDto(node)
		dto.Chat, dto.Workflow, dto.RemainingPasses = "", "", nil
		clip.FlowNodes = append(clip.FlowNodes, dto)
	}
	httpx.WriteJSON(w, http.StatusOK, clip)
}

func (a *API) pasteWorkflow(w http.ResponseWriter, r *http.Request) {
	req, err := decode[PasteWorkflowRequestDto](r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	clip := req.Clipboard
	if clip.Kind != workflowClipKind || clip.Version != workflowClipVersion || clip.Workflow == nil || clip.FlowNodes == nil {
		httpx.WriteError(w, r, entities.Invalidf("expected a kiao-workflow version 1 clipboard with a workflow and flowNodes"))
		return
	}
	ctx := r.Context()
	board, err := a.boards.Find(ctx, r.PathValue("handle"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	source := make([]services.NewFlowNodeRequest, 0, len(clip.FlowNodes))
	for _, node := range clip.FlowNodes {
		source = append(source, flowNodeRequest(node))
	}
	group := entities.Workflow{
		Name: clip.Workflow.Name, Values: string(clip.Workflow.Values),
		WorkflowFolder: clip.Workflow.WorkflowFolder, Files: clip.Workflow.Files,
	}
	workflow, nodes, err := a.flowNodes.PasteWorkflow(ctx, board.ID, group, source, spotOf(req.Spot), actorOf(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]FlowNodeDto, 0, len(nodes))
	for _, node := range nodes {
		out = append(out, flowNodeDto(node))
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"workflow": workflowDto(workflow), "flowNodes": out,
	})
}
