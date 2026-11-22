package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClaimRequiresUpdatedRunner(t *testing.T) {
	a := New(Options{RequireAgentPackages: true})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/boards/test/flow-nodes/task/play", strings.NewReader(`{"run":"run"}`))
	a.playFlowNode(w, r)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "upgrade this runner") {
		t.Fatalf("old runner claim: %d %s", w.Code, w.Body.String())
	}
}
