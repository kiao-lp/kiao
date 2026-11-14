package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"kiao/hybridflow-store/adapters/httpapi"
)

func TestNoteAndValueCardsOverHTTP(t *testing.T) {
	handler, _ := serve(t)
	call(t, handler, "POST", "/boards", `{"name":"Major"}`)
	w := call(t, handler, "POST", "/boards/major/flow-nodes",
		`{"flowNodes":[{"type":"note","title":"Ignored","note":"# Hi"},{"type":"value","title":"Cfg","value":{"a":1}}]}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d %q", w.Code, w.Body.String())
	}
	made := decodeBody[map[string][]httpapi.FlowNodeDto](t, w)
	if made["flowNodes"][0].Type != "note" || made["flowNodes"][0].Note != "# Hi" || made["flowNodes"][0].Title != "" {
		t.Errorf("note dto = %+v", made["flowNodes"][0])
	}
	if made["flowNodes"][1].Type != "value" || string(made["flowNodes"][1].Value) != `{"a":1}` {
		t.Errorf("value dto = %+v", made["flowNodes"][1])
	}
	w = call(t, handler, "PATCH", "/boards/major/flow-nodes/"+made["flowNodes"][1].ID, `{"value":{"b":2}}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"b":2`) {
		t.Errorf("patch value = %d %q", w.Code, w.Body.String())
	}
	w = call(t, handler, "PATCH", "/boards/major/flow-nodes/"+made["flowNodes"][1].ID, `{"value":{bad}}`)
	if w.Code == http.StatusOK {
		t.Errorf("bad JSON patch accepted: %q", w.Body.String())
	}
}
