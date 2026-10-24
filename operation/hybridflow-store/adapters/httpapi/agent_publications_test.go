package httpapi_test

import (
	"net/http"
	"strconv"
	"testing"

	"kiao/hybridflow-store/adapters/httpapi"
	"kiao/hybridflow-store/core/entities"
)

func TestAgentPublicationAndArchiveRoutes(t *testing.T) {
	handler, _ := serve(t)
	draft := decodeBody[httpapi.AgentDto](t, call(t, handler, "POST", "/agents",
		`{"name":"Reviewer","platform":"codex","model":"retired-model","instructions":"Keep these words."}`))
	path := "/agents/" + draft.ID
	res := call(t, handler, "POST", path+"/publish", `{}`, "If-Match", strconv.FormatInt(draft.Revision, 10))
	if res.Code != http.StatusCreated {
		t.Fatalf("publish: %d %s", res.Code, res.Body)
	}
	published := decodeBody[httpapi.AgentDto](t, res)
	if published.Published == nil || published.Published.Version != 1 {
		t.Fatalf("publication = %+v", published)
	}
	if res := call(t, handler, "POST", path+"/publish", `{}`, "If-Match", strconv.FormatInt(draft.Revision, 10)); res.Code != http.StatusConflict {
		t.Fatalf("stale publication: %d", res.Code)
	}
	call(t, handler, "PATCH", path, `{"archived":true}`)
	active := decodeBody[map[string][]httpapi.AgentDto](t, call(t, handler, "GET", "/agents", ""))
	all := decodeBody[map[string][]httpapi.AgentDto](t, call(t, handler, "GET", "/agents?archived=true", ""))
	if len(active["agents"]) != 0 || len(all["agents"]) != 1 || !all["agents"][0].Archived {
		t.Fatalf("active = %+v, all = %+v", active, all)
	}
	versions := decodeBody[map[string][]entities.AgentVersion](t, call(t, handler, "GET", path+"/versions", ""))["versions"]
	if len(versions) != 1 || versions[0].Model != "retired-model" || versions[0].Instructions != "Keep these words." {
		t.Fatalf("history = %+v", versions)
	}
	if res := call(t, handler, "DELETE", path, ""); res.Code != http.StatusBadRequest {
		t.Fatalf("delete published agent: %d %s", res.Code, res.Body)
	}
}
