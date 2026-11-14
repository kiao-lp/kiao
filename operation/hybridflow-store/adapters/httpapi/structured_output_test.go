package httpapi_test

import (
	"fmt"
	"net/http"
	"testing"

	"kiao/hybridflow-store/adapters/httpapi"
)

func TestStructuredOutputHTTP(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Schemas"}`)
	call(t, handler, "POST", "/boards", `{"name":"Tasks"}`)
	const schemaID = "11111111-1111-1111-1111-111111111111"
	w := call(t, handler, "POST", "/boards/schemas/flow-nodes", `{"flowNodes":[{"id":"`+schemaID+`","title":"Greeting","type":"value","valueType":"json-schema","value":{"type":"object"}}]}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("schema = %d %s", w.Code, w.Body.String())
	}
	values := decodeBody[struct {
		SchemaValues []httpapi.SchemaValueDto `json:"schemaValues"`
	}](t, call(t, handler, "GET", "/schema-values", ""))
	if len(values.SchemaValues) != 1 || values.SchemaValues[0].ID != schemaID || values.SchemaValues[0].BoardSlug != "schemas" {
		t.Fatalf("catalogue = %+v", values)
	}
	if w := call(t, handler, "GET", "/schema-values/"+schemaID, ""); w.Code != http.StatusOK {
		t.Fatalf("resolve = %d %s", w.Code, w.Body.String())
	}
	agent := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents", `{"name":"Writer","harness":"claude"}`))
	w = call(t, handler, "POST", "/boards/tasks/flow-nodes", fmt.Sprintf(`{"flowNodes":[{"title":"Write","type":"ai","outputType":%q,"settings":{"agent":%q,"effort":"high","permission":"bypassPermissions","folder":"/"}}]}`, schemaID, agent.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("task = %d %s", w.Code, w.Body.String())
	}
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, w)["flowNodes"][0]
	if made.OutputType != schemaID {
		t.Fatalf("output type = %q", made.OutputType)
	}
	path := "/boards/tasks/flow-nodes/" + made.ID
	call(t, handler, "POST", path+"/play", `{"run":"run-1"}`)
	w = call(t, handler, "POST", path+"/played", `{"run":"run-1","status":"done","output":{"message":"hello"}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("completion = %d %s", w.Code, w.Body.String())
	}
	got := decodeBody[httpapi.FlowNodeDto](t, call(t, handler, "GET", path, ""))
	if string(got.Output) != `{"message":"hello"}` || got.Status != "done" {
		t.Fatalf("output = %+v", got)
	}
	w = call(t, handler, "PATCH", path, `{"outputType":""}`)
	got = decodeBody[httpapi.FlowNodeDto](t, w)
	if got.OutputType != "" || len(got.Output) > 0 {
		t.Fatalf("clear = %+v", got)
	}
}
