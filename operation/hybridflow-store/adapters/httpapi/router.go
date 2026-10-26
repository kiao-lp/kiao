package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kiao/hybridflow-store/adapters/auth"
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
	"kiao/hybridflow-store/core/services"
	"kiao/hybridflow-store/lib/httpx"
	"kiao/hybridflow-store/lib/logging"
)

// API is the HTTP surface, wired to the core's services and to nothing else. It holds no pool, no
// driver and no SQL: what it can do is what the services expose.
type API struct {
	boards          *services.Boards
	flowNodes       *services.FlowNodes
	flowNodeClasses *services.FlowNodeClasses
	workflows       *services.Workflows
	agents          *services.Agents
	runners         *services.Runners
	usage           *services.Usage
	changes         ports.ChangeLog
	schema          SchemaDto
	// watchTimeout bounds a held request. A wait that never ends is a connection a proxy kills at a
	// moment nobody chose; one that ends by itself is a client that asks again.
	watchTimeout time.Duration
}

// Options is what the adapter is built with. The schema history is passed in as a value rather than
// read from the storage adapter, because an adapter may not import another: the program is the one
// place that knows both, and it hands this one what it needs.
type Options struct {
	Boards          *services.Boards
	FlowNodes       *services.FlowNodes
	FlowNodeClasses *services.FlowNodeClasses
	Workflows       *services.Workflows
	Agents          *services.Agents
	Runners         *services.Runners
	Usage           *services.Usage
	Changes         ports.ChangeLog
	Schema          SchemaDto
	WatchTimeout    time.Duration
}

// New wires the surface.
func New(opts Options) *API {
	timeout := opts.WatchTimeout
	if timeout <= 0 {
		timeout = 25 * time.Second
	}
	return &API{
		boards: opts.Boards, flowNodes: opts.FlowNodes, flowNodeClasses: opts.FlowNodeClasses,
		workflows: opts.Workflows,
		agents:    opts.Agents, runners: opts.Runners, usage: opts.Usage,
		changes: opts.Changes, schema: opts.Schema, watchTimeout: timeout,
	}
}

// Handler is the whole server: the routes, behind the middleware chain, with the liveness probe
// registered outside it.
//
// The chain is worker's, outermost first — recover → request-id → trace → cors → auth —
// and for the same reasons: a panic in one handler must not take the process down, every line a
// request writes must be correlatable with the request, and the probe must be cheap and
// unauthenticated so that a load balancer is not holding a Keycloak dependency.
func (a *API) Handler(authenticator *auth.Authenticator, origins []string) http.Handler {
	mux := http.NewServeMux()
	a.routes(mux)

	root := http.NewServeMux()
	// Outside the chain: no auth, no trace line, no allocation worth speaking of.
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.Handle("/", recoverPanics(withRequestID(traced(cors(origins, authenticator.Middleware(mux))))))
	return root
}

func (a *API) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /schema", a.getSchema)

	mux.HandleFunc("GET /boards", a.listBoards)
	mux.HandleFunc("POST /boards", a.createBoard)
	mux.HandleFunc("GET /boards/{handle}", a.getBoard)
	mux.HandleFunc("PATCH /boards/{handle}", a.patchBoard)
	mux.HandleFunc("DELETE /boards/{handle}", a.deleteBoard)

	mux.HandleFunc("POST /boards/{handle}/flow-nodes", a.createFlowNodes)
	mux.HandleFunc("DELETE /boards/{handle}/flow-nodes", a.deleteFlowNodes)
	mux.HandleFunc("GET /boards/{handle}/flow-nodes/{id}", a.getFlowNode)
	mux.HandleFunc("PATCH /boards/{handle}/flow-nodes/{id}", a.patchFlowNode)
	mux.HandleFunc("POST /boards/{handle}/flow-nodes/{id}/chain", a.chainFlowNode)
	mux.HandleFunc("POST /boards/{handle}/flow-nodes/{id}/play", a.playFlowNode)
	mux.HandleFunc("POST /boards/{handle}/flow-nodes/{id}/played", a.playedFlowNode)
	mux.HandleFunc("POST /boards/{handle}/flow-nodes/{id}/usage", a.recordUsage)
	mux.HandleFunc("GET /boards/{handle}/flow-nodes/{id}/usage", a.getUsageTotals)
	mux.HandleFunc("POST /boards/{handle}/flow-nodes/{id}/to-class", a.convertFlowNodeToClass)

	mux.HandleFunc("GET /flow-node-classes", a.listFlowNodeClasses)
	mux.HandleFunc("POST /boards/{handle}/flow-node-classes", a.createFlowNodeClass)
	mux.HandleFunc("DELETE /boards/{handle}/flow-node-classes", a.deleteFlowNodeClasses)
	mux.HandleFunc("GET /boards/{handle}/flow-node-classes/{id}", a.getFlowNodeClass)
	mux.HandleFunc("PATCH /boards/{handle}/flow-node-classes/{id}", a.patchFlowNodeClass)
	mux.HandleFunc("POST /boards/{handle}/flow-node-classes/{id}/chain", a.chainFlowNodeClass)
	mux.HandleFunc("POST /boards/{handle}/flow-node-classes/{id}/versions", a.createClassVersion)
	mux.HandleFunc("PATCH /boards/{handle}/flow-node-classes/{id}/versions/{versionId}", a.patchClassVersion)
	mux.HandleFunc("DELETE /boards/{handle}/flow-node-classes/{id}/versions/{versionId}", a.deleteClassVersion)
	mux.HandleFunc("POST /boards/{handle}/flow-node-classes/{id}/instantiate", a.instantiateFlowNodeClass)

	mux.HandleFunc("POST /boards/{handle}/workflows", a.createWorkflow)
	mux.HandleFunc("DELETE /boards/{handle}/workflows", a.deleteWorkflows)
	mux.HandleFunc("GET /boards/{handle}/workflows/{id}", a.getWorkflow)
	mux.HandleFunc("PATCH /boards/{handle}/workflows/{id}", a.patchWorkflow)

	mux.HandleFunc("GET /workflow-classes", a.listWorkflowClasses)
	mux.HandleFunc("POST /boards/{handle}/workflow-classes", a.createWorkflowClass)
	mux.HandleFunc("DELETE /boards/{handle}/workflow-classes", a.deleteWorkflowClasses)
	mux.HandleFunc("GET /boards/{handle}/workflow-classes/{id}", a.getWorkflowClass)
	mux.HandleFunc("PATCH /boards/{handle}/workflow-classes/{id}", a.patchWorkflowClass)
	mux.HandleFunc("POST /boards/{handle}/workflow-classes/{id}/instantiate", a.instantiateWorkflowClass)

	mux.HandleFunc("GET /changes", a.getChanges)
	mux.HandleFunc("POST /runs/{run}/settle", a.settleRun)

	mux.HandleFunc("GET /agents", a.listAgents)
	mux.HandleFunc("POST /agents", a.createAgent)
	mux.HandleFunc("GET /agents/{id}", a.getAgent)
	mux.HandleFunc("PATCH /agents/{id}", a.patchAgent)
	mux.HandleFunc("DELETE /agents/{id}", a.deleteAgent)
	mux.HandleFunc("POST /agents/{id}/publish", a.publishAgent)
	mux.HandleFunc("GET /agents/{id}/versions", a.agentVersions)

	mux.HandleFunc("GET /runners", a.listRunners)
	mux.HandleFunc("POST /runners", a.createRunner)
	mux.HandleFunc("GET /runners/{id}", a.getRunner)
	mux.HandleFunc("PATCH /runners/{id}", a.patchRunner)
	mux.HandleFunc("DELETE /runners/{id}", a.deleteRunner)
	mux.HandleFunc("POST /runners/{id}/heartbeat", a.heartbeatRunner)
}

// ── the middleware chain ──────────────────────────────────────────────────────

// recoverPanics turns a panic into a 500 with a logged stack, so one bad request cannot take the
// process down. It deliberately does not wrap the ResponseWriter: anything that needs the writer's
// own interfaces must keep reaching them.
func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if problem := recover(); problem != nil {
				logging.Ctx(r.Context()).Error("handler panicked", "component", "http",
					"method", r.Method, "path", r.URL.Path, "panic", problem)
				httpx.WriteJSON(w, http.StatusInternalServerError, httpx.ErrorBody{Error: "internal error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

var requestCounter = func() func() string {
	var n int64
	return func() string {
		n++
		return strconv.FormatInt(time.Now().UnixNano()%1_000_000, 36) + "-" + strconv.FormatInt(n, 36)
	}
}()

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if id == "" {
			id = requestCounter()
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(logging.WithRequestID(r.Context(), id)))
	})
}

// status remembers what was written, for the trace line.
type status struct {
	http.ResponseWriter
	code int
}

func (s *status) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func traced(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &status{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logging.Ctx(r.Context()).Info("request", "component", "trace", "method", r.Method,
			"path", r.URL.Path, "status", recorder.code, "ms", time.Since(started).Milliseconds(),
			"user", auth.From(r.Context()).User)
	})
}

// cors answers the browser's preflight and echoes an allowed origin. A wildcard is not an option:
// the requests carry a bearer token, and a browser refuses `*` with credentials.
func cors(origins []string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, origin := range origins {
		allowed[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || allowed["*"]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, X-Request-Id")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "ETag, X-Request-Id")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── reading a request ─────────────────────────────────────────────────────────

// maxBodyBytes bounds a request. A paste of cards is the largest thing on the wire and is
// measured in kilobytes; four megabytes are room for a very long one and a refusal for anything
// that is not a board.
const maxBodyBytes = 4 << 20

func decode[T any](r *http.Request) (T, error) {
	var payload T
	body := http.MaxBytesReader(nil, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(body)
	// Unknown fields are refused, which is the opposite of how a *document* is read here and is
	// deliberate: a hand-written board must open, and a mistyped API call must not silently do
	// three-quarters of what was asked.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		if errors.Is(err, io.EOF) {
			return payload, httpx.Errorf(http.StatusBadRequest, "the request has no body")
		}
		return payload, httpx.Errorf(http.StatusBadRequest, "the request body could not be read: "+err.Error())
	}
	return payload, nil
}

// revisionOf reads the `If-Match` header: the revision the caller worked from, or nil for a write
// that does not care.
//
// **The header and not a field of the payload**, because that is what it is: a conditional request,
// and a client library that already knows how to retry a 412 or a 409 knows this shape. A value
// that is not a number is refused rather than ignored — a client that meant to be conditional and
// was not would overwrite somebody silently.
func revisionOf(r *http.Request) (*int64, error) {
	raw := strings.Trim(strings.TrimSpace(r.Header.Get("If-Match")), `"`)
	if raw == "" || raw == "*" {
		return nil, nil
	}
	revision, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil, httpx.Errorf(http.StatusBadRequest, fmt.Sprintf("If-Match is %q, want a revision number", raw))
	}
	return &revision, nil
}

func actorOf(r *http.Request) string { return auth.From(r.Context()).Actor() }

func intQuery(r *http.Request, name string, fallback int) int {
	if value, err := strconv.Atoi(r.URL.Query().Get(name)); err == nil {
		return value
	}
	return fallback
}

func int64Query(r *http.Request, name string, fallback int64) int64 {
	if value, err := strconv.ParseInt(r.URL.Query().Get(name), 10, 64); err == nil {
		return value
	}
	return fallback
}

func boolQuery(r *http.Request, name string) bool {
	value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get(name)))
	return value == "1" || value == "true" || value == "yes"
}

// settings reads a settings payload, which is a whole replacement: the five are a set a form
// submits together, and patching one of them alone would make "no model" and "unchanged model" the
// same request.
func settingsOf(dto *SettingsDto) entities.TaskSettings {
	if dto == nil {
		return entities.TaskSettings{}
	}
	return entities.TaskSettings{
		Agent: dto.Agent, Model: dto.Model, Effort: dto.Effort,
		Permission: dto.Permission, Folder: dto.Folder, Runner: dto.Runner, Extra: dto.Extra,
	}
}

// transitionOf is the half of an `onSuccess` that belongs to the task: what becomes of the chat.
// The other half — the card played next — is the flow node's own, and is read beside it.
func transitionOf(dto *SuccessDto) entities.Transition {
	if dto == nil {
		return entities.Transition{Mode: entities.TransitionModeDefault}
	}
	// The retired word said both things at once, so a client still sending it ticks the box as well
	// as naming the mode — and one sending the box beside a mode of its own is taken at its word.
	mode, said := entities.ReadTransitionMode(dto.Mode)
	return entities.Transition{Mode: mode, Compact: said || dto.Compact}
}

func spotOf(dto *SpotDto) *entities.Spot {
	if dto == nil {
		return nil
	}
	return &entities.Spot{X: dto.X, Y: dto.Y}
}

// contextWithTimeout bounds a held request by the watch timeout — and by the client going away,
// which it inherits from the request's own context: a browser that closed the tab must not leave a
// connection waiting out the full timeout for a change nobody will read.
func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, func()) {
	return context.WithTimeout(r.Context(), timeout)
}

// waitOver reports whether err is the wait ending rather than failing: the timeout ran out while a
// query was in flight, or the client went away. Either is answered with what is known — nothing
// new — and never with a 500, which is what the race between a woken waiter and an expired context
// used to give: Await says something landed, and the re-read finds its context gone.
func waitOver(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}
