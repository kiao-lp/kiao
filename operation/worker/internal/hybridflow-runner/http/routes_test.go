package runnerhttp

import (
	coreconfig "kiao/worker/internal/core/config"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"kiao/worker/internal/hybridflow-runner/assembly"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mountedPatterns is what a service actually serves, as a set, so a test can say a pattern is on the
// air without going through the mux.
func mountedPatterns(svc *Service) map[string]bool {
	patterns := map[string]bool{}
	for _, route := range svc.Routes() {
		patterns[route.Pattern] = true
	}
	return patterns
}

// Every REST route is mounted under every prefix. Asserted over the route table rather than one
// endpoint at a time, because the failure worth catching is an endpoint *added* under one name only
// — which no test of a named path would ever notice.
func TestEveryRouteAnswersToEveryPrefix(t *testing.T) {
	svc := newSocketTestServer(t, nil)
	patterns := mountedPatterns(svc)

	rest := 0
	for pattern := range patterns {
		method, path, found := strings.Cut(pattern, " ")
		if !found || !strings.HasPrefix(path, httpPrefix+"/") {
			continue
		}
		rest++
		for _, prefix := range legacyHTTPPrefixes {
			legacy := method + " " + prefix + strings.TrimPrefix(path, httpPrefix)
			if !patterns[legacy] {
				t.Errorf("%q is mounted and %q is not; the names are one endpoint with several names", pattern, legacy)
			}
		}
	}
	if rest == 0 {
		t.Fatal("no /hybridflow-runner route was mounted at all")
	}
	for _, path := range SocketPaths() {
		if !patterns[path] {
			t.Errorf("socket path %q is not mounted, want every socket path", path)
		}
	}
}

// An old name is the same endpoint and not a redirect: same status, same body.
func TestTheLegacyPrefixesServeTheSamePayload(t *testing.T) {
	svc := newSocketTestServer(t, newTestConversationStore(t))

	fresh := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/conversations", nil))
	if fresh.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 on the new name", fresh.Code)
	}
	for _, prefix := range legacyHTTPPrefixes {
		legacy := do(svc, httptest.NewRequest(http.MethodGet, prefix+"/conversations", nil))
		if legacy.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 on %s", legacy.Code, prefix)
		}
		if fresh.Body.String() != legacy.Body.String() {
			t.Errorf("bodies differ:\n /hybridflow-runner %s\n %s %s", fresh.Body.String(), prefix, legacy.Body.String())
		}
	}
}

// The socket answers on every path, and it is the same hub behind them: each dial is greeted by the
// same unprompted `hello`.
func TestTheSocketAnswersOnEveryPath(t *testing.T) {
	srv := newSocketTestServer(t, nil)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	for _, path := range SocketPaths() {
		conn := dialAt(t, ts.URL, path)
		hello := readFrame(t, conn)
		if hello["type"] != "hello" {
			t.Errorf("%s: first frame = %v, want hello", path, hello["type"])
		}
		if version, _ := hello["protocolVersion"].(float64); int(version) != pkgTurns.AgentProtocolVersion {
			t.Errorf("%s: protocolVersion = %v, want %d", path, hello["protocolVersion"], pkgTurns.AgentProtocolVersion)
		}
		conn.Close()
	}
}

// A side port nothing answers leaves its route unmounted — under *every* name. An alias is another
// name for a route that exists, never a route of its own.
func TestAnUnansweredSidePortIsUnmountedUnderEveryName(t *testing.T) {
	cfg := &runnerconfig.Config{Config: &coreconfig.Config{AuthMode: "debug", RootPath: t.TempDir()}}
	hub := assembly.NewEngine(cfg, nil)
	// Every agent replaced by one that answers no side port at all, which is what leaves the quota
	// unmounted now that it is asked per agent: a route that exists for one engine and not another
	// would be mounted, and this test is about the case where nothing answers it.
	hub.Agents.Set(agentapi.AgentClaude, &stubAgent{})
	hub.Agents.Set(agentapi.AgentCodex, &stubAgent{})
	hub.Agents.Set(agentapi.AgentMuse, &stubAgent{})
	svc := &Service{cfg: cfg, hub: hub}
	svc.bindAgents(hub.Agents)
	svc.login = nil

	patterns := mountedPatterns(svc)
	for _, prefix := range append([]string{httpPrefix}, legacyHTTPPrefixes...) {
		for _, pattern := range []string{
			"GET " + prefix + "/usage",
			"GET " + prefix + "/auth/status",
		} {
			if patterns[pattern] {
				t.Errorf("%q is mounted, want an endpoint that cannot work to be absent instead", pattern)
			}
		}
	}
}

// The runs answer under the name they had before the workflow run was renamed a chain run, and
// it is the same endpoint behind both: same status, same body.
func TestTheRunsAnswerUnderTheirOldName(t *testing.T) {
	svc := newSocketTestServer(t, newTestConversationStore(t))

	fresh := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/chain-runs", nil))
	if fresh.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 on the new name", fresh.Code)
	}
	legacy := do(svc, httptest.NewRequest(http.MethodGet, "/hybridflow-runner/workflow-runs", nil))
	if legacy.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 on the old name", legacy.Code)
	}
	if fresh.Body.String() != legacy.Body.String() {
		t.Errorf("bodies differ:\n chain-runs %s\n workflow-runs %s", fresh.Body.String(), legacy.Body.String())
	}
}
