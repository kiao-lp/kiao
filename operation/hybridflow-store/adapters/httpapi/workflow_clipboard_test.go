package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"kiao/hybridflow-store/adapters/httpapi"
	"kiao/hybridflow-store/core/entities"
)

func TestWorkflowClipboardOverTheWire(t *testing.T) {
	handler, _ := serve(t)
	post := func(path string, payload any, status int) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		w := call(t, handler, http.MethodPost, path, string(body))
		if w.Code != status {
			t.Fatalf("POST %s = %d, want %d: %s", path, w.Code, status, w.Body)
		}
		return w
	}
	post("/boards", httpapi.NewBoardRequestDto{Name: "Source"}, http.StatusCreated)
	post("/boards", httpapi.NewBoardRequestDto{Name: "Destination"}, http.StatusCreated)
	folder, files := "/release", []string{"/sources/brief.md", "/sources/templates"}
	group := decodeBody[httpapi.WorkflowDto](t, post("/boards/source/workflows",
		httpapi.NewWorkflowRequestDto{Name: "Release", WorkflowFolder: folder, Files: files}, http.StatusCreated))
	const values = `{"phase":{"steps":[false,null,3]},"ready":true}`
	updated := call(t, handler, http.MethodPatch, "/boards/source/workflows/"+group.ID, `{"setValues":`+values+`}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("set workflow values = %d: %s", updated.Code, updated.Body)
	}

	schemaID := "00000000-0000-4000-8000-000000000101"
	reportID := "00000000-0000-4000-8000-000000000102"
	chooseID := "00000000-0000-4000-8000-000000000103"
	waitID := "00000000-0000-4000-8000-000000000104"
	limitID := "00000000-0000-4000-8000-000000000105"
	outsideID := "00000000-0000-4000-8000-000000000106"
	exampleID := "00000000-0000-4000-8000-000000000107"
	maxPasses, remaining := 3, 0
	source := []httpapi.NewFlowNodeDto{
		{ID: reportID, Title: "Report", Type: "human", Workflow: group.ID, OutputType: schemaID,
			Body: "Write the report", Criteria: []httpapi.CriterionDto{{ID: reportID, Text: "Include the result"}},
			Settings: &httpapi.SettingsDto{Extra: map[string]string{"extension": "keep"}},
			Chat:     "source-chat", Status: "done", Spot: &httpapi.SpotDto{X: 30, Y: 40},
			OnSuccess: &httpapi.SuccessDto{FlowNode: chooseID}},
		{ID: chooseID, Title: "Choose", Type: "exclusive-gateway", Workflow: group.ID,
			Spot:      &httpapi.SpotDto{X: 290, Y: 40},
			OnSuccess: &httpapi.SuccessDto{FlowNodes: []string{outsideID, waitID}},
			Routes:    []entities.Route{{Condition: "false", FlowNode: outsideID}, {Condition: "true", FlowNode: waitID}}},
		{ID: waitID, Title: "Wait", Type: "scheduler", Workflow: group.ID, Duration: "15m", Status: "draft",
			Spot: &httpapi.SpotDto{X: 550, Y: 40}, OnSuccess: &httpapi.SuccessDto{FlowNode: limitID}},
		{ID: limitID, Title: "Limit", Type: "limiter", Workflow: group.ID,
			MaxPasses: &maxPasses, RemainingPasses: &remaining, Status: "done",
			Size: &httpapi.SizeDto{W: 300, H: 220}, Spot: &httpapi.SpotDto{X: 550, Y: 250}},
		{ID: outsideID, Title: "Outside", Type: "shutdown", Spot: &httpapi.SpotDto{X: 290, Y: 250}},
		{ID: schemaID, Title: "Schema", Type: "value", Workflow: group.ID,
			ValueType: "json-schema", Value: json.RawMessage(`{"type":"null"}`)},
		{ID: exampleID, Title: "Example", Type: "value", Workflow: group.ID, Archived: true,
			ValueType: schemaID, Value: json.RawMessage(`null`)},
	}
	post("/boards/source/flow-nodes", httpapi.NewFlowNodesRequestDto{FlowNodes: source}, http.StatusCreated)
	path := "/workflows/" + group.ID + "/clipboard"
	if w := call(t, handler, http.MethodGet, "/boards/destination"+path, ""); w.Code != http.StatusNotFound {
		t.Fatalf("wrong source board = %d, want 404", w.Code)
	}
	copyResponse := call(t, handler, http.MethodGet, "/boards/source"+path, "")
	if copyResponse.Code != http.StatusOK {
		t.Fatalf("copy = %d: %s", copyResponse.Code, copyResponse.Body)
	}
	clip := decodeBody[httpapi.WorkflowClipDto](t, copyResponse)
	if clip.Kind != "kiao-workflow" || clip.Version != 1 || clip.Workflow == nil ||
		clip.Workflow.Name != group.Name || string(clip.Workflow.Values) != values || len(clip.FlowNodes) != len(source)-1 ||
		clip.Workflow.WorkflowFolder != folder || !slices.Equal(clip.Workflow.Files, files) {
		t.Fatalf("clipboard = %s", copyResponse.Body)
	}
	for _, field := range []string{`"chat"`, `"remainingPasses"`, `"revision"`} {
		if strings.Contains(copyResponse.Body.String(), field) {
			t.Errorf("clipboard contains runtime or source metadata %s", field)
		}
	}

	for _, handle := range []string{"source", "destination"} {
		at := &httpapi.SpotDto{X: 30, Y: 40}
		if handle == "destination" {
			// Clipboard order can differ from the board's ID order.
			clip.FlowNodes[0], clip.FlowNodes[1] = clip.FlowNodes[1], clip.FlowNodes[0]
			settings := clip.FlowNodes[0].Settings
			settings.Agent, settings.Harness, settings.Model, settings.ProfileID = "foreign", "pi", "model", "profile"
			settings.Runner = "another-runner"
		}
		paste := decodeBody[struct {
			Workflow  httpapi.WorkflowDto
			FlowNodes []httpapi.FlowNodeDto
		}](t, post("/boards/"+handle+"/workflows/clipboard",
			httpapi.PasteWorkflowRequestDto{Clipboard: clip, Spot: at}, http.StatusCreated))
		if paste.Workflow.ID == group.ID || paste.Workflow.Name != group.Name ||
			string(paste.Workflow.Values) != values || len(paste.FlowNodes) != len(clip.FlowNodes) ||
			paste.Workflow.WorkflowFolder != folder || !slices.Equal(paste.Workflow.Files, files) {
			t.Fatalf("pasted workflow = %+v, values = %s, flow nodes = %d", paste.Workflow, paste.Workflow.Values, len(paste.FlowNodes))
		}
		byTitle := make(map[string]httpapi.FlowNodeDto)
		for _, flowNode := range paste.FlowNodes {
			if flowNode.Workflow != paste.Workflow.ID {
				t.Errorf("%s belongs to %s, want %s", flowNode.Title, flowNode.Workflow, paste.Workflow.ID)
			}
			for _, original := range source {
				if original.ID == flowNode.ID {
					t.Errorf("flow node %q reused a source id", flowNode.Title)
				}
			}
			byTitle[flowNode.Title] = flowNode
		}
		report, choose, wait, limit := byTitle["Report"], byTitle["Choose"], byTitle["Wait"], byTitle["Limit"]
		schema, example := byTitle["Schema"], byTitle["Example"]
		if !(schema.ID < report.ID && report.ID < choose.ID) {
			t.Error("copy changed the relative ID ordering used by joins")
		}
		if report.Chat != "" || report.Run != "" || report.Status != "ready" ||
			report.OnSuccess == nil || report.OnSuccess.FlowNode != choose.ID ||
			report.OutputType != schema.ID || len(report.Criteria) != 1 ||
			report.Criteria[0].ID == reportID || report.Criteria[0].Text != "Include the result" {
			t.Errorf("report = %+v", report)
		}
		if settings := report.Settings; settings == nil || settings.Extra["extension"] != "keep" ||
			settings.Agent != "" || settings.Harness != "" || settings.Model != "" || settings.ProfileID != "" || settings.Runner != "" {
			t.Errorf("report settings = %+v", settings)
		}
		if choose.OnSuccess == nil || len(choose.OnSuccess.FlowNodes) != 1 || choose.OnSuccess.FlowNodes[0] != wait.ID ||
			len(choose.Routes) != 1 || choose.Routes[0] != (entities.Route{Condition: "true", FlowNode: wait.ID}) {
			t.Errorf("gateway successors = %+v, routes = %+v", choose.OnSuccess, choose.Routes)
		}
		if wait.Duration != "15m" || wait.Status != "draft" || wait.OnSuccess == nil || wait.OnSuccess.FlowNode != limit.ID ||
			limit.RemainingPasses == nil || *limit.RemainingPasses != maxPasses || limit.Size == nil || *limit.Size != *source[3].Size {
			t.Errorf("scheduler = %+v, limiter = %+v", wait, limit)
		}
		if !example.Archived || example.ValueType != schema.ID || string(example.Value) != "null" {
			t.Errorf("typed value = %+v", example)
		}
		sourceBottom := source[3].Spot.Y + source[3].Size.H
		if choose.Spot == nil || report.Spot == nil || choose.Spot.X-report.Spot.X != 260 || choose.Spot.Y != report.Spot.Y ||
			(handle == "source" && report.Spot.Y <= sourceBottom) ||
			(handle == "destination" && *report.Spot != *at) {
			t.Errorf("%s placement: report %+v, gateway %+v", handle, report.Spot, choose.Spot)
		}
	}

	for _, badValues := range []string{`[]`, `null`, `{"id":"source"}`, `{"name":"Other"}`} {
		invalid := clip
		invalid.Workflow = &httpapi.WorkflowClipDataDto{Name: group.Name, Values: json.RawMessage(badValues)}
		post("/boards/source/workflows/clipboard", httpapi.PasteWorkflowRequestDto{Clipboard: invalid}, http.StatusBadRequest)
	}

	clip.FlowNodes = append(clip.FlowNodes, clip.FlowNodes[0])
	post("/boards/source/workflows/clipboard", httpapi.PasteWorkflowRequestDto{Clipboard: clip}, http.StatusBadRequest)
	board := decodeBody[httpapi.BoardDetailDto](t, call(t, handler, http.MethodGet, "/boards/source", ""))
	if len(board.Workflows) != 2 || len(board.FlowNodes) != 2*len(source)-1 {
		t.Fatalf("source board groups = %d, flow nodes = %d", len(board.Workflows), len(board.FlowNodes))
	}
	for _, flowNode := range board.FlowNodes {
		if flowNode.ID == reportID && (flowNode.Workflow != group.ID || flowNode.OnSuccess.FlowNode != chooseID || flowNode.Chat != "source-chat") {
			t.Errorf("copy changed the source flow node: %+v", flowNode)
		}
	}

	legacy := post("/boards/destination/workflows/clipboard", map[string]any{
		"clipboard": map[string]any{
			"kind": "kiao-workflow", "version": 1, "workflow": map[string]string{"name": "Legacy"}, "flowNodes": []any{},
		},
	}, http.StatusCreated)
	legacyWorkflow := decodeBody[struct{ Workflow httpapi.WorkflowDto }](t, legacy).Workflow
	if legacyWorkflow.Name != "Legacy" || len(legacyWorkflow.Values) != 0 {
		t.Fatalf("legacy workflow = %s", legacy.Body)
	}
}
