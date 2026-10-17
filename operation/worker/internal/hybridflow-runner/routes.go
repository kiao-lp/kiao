package hybridflowrunner

import (
	"strings"

	"kiao/worker/internal/core"
)

// SocketPath is where the turn socket lives, and legacySocketPaths are where it used to: `/ws/agent`,
// and `/ws/claude` when there was one agent and the socket was named after it. All are served, and
// all are named because the trace middleware has to step over them — a socket hijacks the connection
// and never sets a status a trace line could report.
//
// The socket is the one surface that has broken compatibility deliberately before: a client built
// against another `hello.protocolVersion` is told to reload, which is the whole mechanism. So an old
// path is kept for as long as it costs nothing rather than as a promise — see SocketPaths.
const SocketPath = "/ws/hybridflow-runner"

// legacySocketPaths is every name the turn socket answered to before this one, newest first.
var legacySocketPaths = []string{"/ws/agent", "/ws/claude"}

// SocketPaths is every path the turn socket answers on, for the middleware that must not trace them.
func SocketPaths() []string {
	paths := make([]string, 0, len(legacySocketPaths)+1)
	paths = append(paths, SocketPath)
	return append(paths, legacySocketPaths...)
}

// httpPrefix is where this half's REST surface lives, and legacyHTTPPrefixes are where it lived
// before: `/agents`, and `/claude` when there was one agent and the endpoints were named after it.
//
// **The HTTP surface has never broken compatibility, and this pass does not start.** Unlike the
// socket, nothing on it announces a version, so a client left on the old paths has no way of being
// told to move — a script, a bookmarked curl, a `kiao-mcp` bundle staged by an older build. Every
// route below is therefore mounted under every prefix, answering the same handler with the same
// payload: the names are one endpoint with several names, not several endpoints.
const httpPrefix = "/hybridflow-runner"

// legacyHTTPPrefixes is every prefix this half's REST surface answered under before this one, newest
// first.
var legacyHTTPPrefixes = []string{"/agents", "/claude"}

// Routes is this half's HTTP surface: the pattern net/http routes on, and what answers it. The
// program mounts them — nothing is served that it did not mount — and mounts the other half's the
// same way.
//
// Four of them are mounted only when an agent answers the side port behind them (driver.go): the
// quota, the prompt's options, and the two sign-ins. A deployment whose agents have no quota to
// report leaves `GET /hybridflow-runner/usage` unmounted rather than serving an endpoint that cannot work —
// the same shape a deployment with sign-in switched off already has.
//
// The Claude sign-in is the *default* agent's; the quota, the options and the API-key sign-in
// answer **per agent**, and each is mounted as long as one agent has something to say (see
// usage.go, api.go and muse_login.go). The quota had to follow the options there the moment a
// second agent grew one: an account is an agent's, and a panel showing several conversations at
// once shows several accounts with them — and the sign-in followed for the same reason the moment
// a second agent grew one of its own.
func (s *Service) Routes() []core.Route {
	routes := aliased([]core.Route{
		{Pattern: "POST /hybridflow-runner/attachments", Handler: s.HandleUploadAttachment},
		{Pattern: "GET /hybridflow-runner/attachments/{id}", Handler: s.HandleGetAttachment},
		{Pattern: "GET /hybridflow-runner/conversations", Handler: s.HandleListConversations},
		{Pattern: "POST /hybridflow-runner/conversations", Handler: s.HandleCreateConversation},
		{Pattern: "GET /hybridflow-runner/conversations/{id}", Handler: s.HandleGetConversation},
		{Pattern: "PATCH /hybridflow-runner/conversations/{id}", Handler: s.HandlePatchConversation},
		{Pattern: "DELETE /hybridflow-runner/conversations/{id}", Handler: s.HandleDeleteConversation},
		{Pattern: "POST /hybridflow-runner/conversations/{id}/fork", Handler: s.HandleForkConversation},
		{Pattern: "GET /hybridflow-runner/boards", Handler: s.HandleListBoards},
		{Pattern: "POST /hybridflow-runner/boards", Handler: s.HandleCreateBoard},
		{Pattern: "GET /hybridflow-runner/boards/{handle}", Handler: s.HandleGetBoard},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}", Handler: s.HandlePatchBoard},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}", Handler: s.HandleDeleteBoard},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-nodes", Handler: s.HandleCreateFlowNodes},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}/flow-nodes", Handler: s.HandleDeleteFlowNodes},
		{Pattern: "GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}", Handler: s.HandleGetFlowNode},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}/flow-nodes/{id}", Handler: s.HandlePatchFlowNode},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-nodes/{id}/chain", Handler: s.HandleChainFlowNode},
		{Pattern: "GET /hybridflow-runner/boards/{handle}/flow-nodes/{id}/usage", Handler: s.HandleGetFlowNodeUsage},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-nodes/{id}/to-class", Handler: s.HandleConvertFlowNode},
		{Pattern: "GET /hybridflow-runner/flow-node-classes", Handler: s.HandleListFlowNodeClasses},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-node-classes", Handler: s.HandleCreateFlowNodeClass},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}/flow-node-classes", Handler: s.HandleDeleteFlowNodeClasses},
		{Pattern: "GET /hybridflow-runner/boards/{handle}/flow-node-classes/{id}", Handler: s.HandleGetFlowNodeClass},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}/flow-node-classes/{id}", Handler: s.HandlePatchFlowNodeClass},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/chain", Handler: s.HandleChainFlowNodeClass},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions", Handler: s.HandleCreateClassVersion},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions/{versionId}", Handler: s.HandlePatchClassVersion},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/versions/{versionId}", Handler: s.HandleDeleteClassVersion},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/flow-node-classes/{id}/instantiate", Handler: s.HandleInstantiateFlowNodeClass},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/workflows", Handler: s.HandleCreateWorkflow},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}/workflows", Handler: s.HandleDeleteWorkflows},
		{Pattern: "GET /hybridflow-runner/boards/{handle}/workflows/{id}", Handler: s.HandleGetWorkflow},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}/workflows/{id}", Handler: s.HandlePatchWorkflow},
		{Pattern: "GET /hybridflow-runner/workflow-classes", Handler: s.HandleListWorkflowClasses},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/workflow-classes", Handler: s.HandleCreateWorkflowClass},
		{Pattern: "DELETE /hybridflow-runner/boards/{handle}/workflow-classes", Handler: s.HandleDeleteWorkflowClasses},
		{Pattern: "GET /hybridflow-runner/boards/{handle}/workflow-classes/{id}", Handler: s.HandleGetWorkflowClass},
		{Pattern: "PATCH /hybridflow-runner/boards/{handle}/workflow-classes/{id}", Handler: s.HandlePatchWorkflowClass},
		{Pattern: "POST /hybridflow-runner/boards/{handle}/workflow-classes/{id}/instantiate", Handler: s.HandleInstantiateWorkflowClass},
		{Pattern: "GET /hybridflow-runner/changes", Handler: s.HandleGetChanges},
		{Pattern: "GET /hybridflow-runner/schema", Handler: s.HandleGetHybridflowSchema},
		{Pattern: "GET /hybridflow-runner/agents", Handler: s.HandleListAgents},
		{Pattern: "POST /hybridflow-runner/agents", Handler: s.HandleCreateAgent},
		{Pattern: "GET /hybridflow-runner/agents/{id}", Handler: s.HandleGetAgent},
		{Pattern: "PATCH /hybridflow-runner/agents/{id}", Handler: s.HandlePatchAgent},
		{Pattern: "DELETE /hybridflow-runner/agents/{id}", Handler: s.HandleDeleteAgent},
		{Pattern: "GET /hybridflow-runner/runners", Handler: s.HandleListRunners},
		{Pattern: "POST /hybridflow-runner/runners", Handler: s.HandleCreateRunner},
		{Pattern: "GET /hybridflow-runner/runners/{id}", Handler: s.HandleGetRunner},
		{Pattern: "PATCH /hybridflow-runner/runners/{id}", Handler: s.HandlePatchRunner},
		{Pattern: "DELETE /hybridflow-runner/runners/{id}", Handler: s.HandleDeleteRunner},
		{Pattern: "GET /hybridflow-runner/chain-runs", Handler: s.HandleGetChainRuns},
		{Pattern: "POST /hybridflow-runner/chain-runs/play", Handler: s.HandlePlayChainRun},
		{Pattern: "POST /hybridflow-runner/chain-runs/stop", Handler: s.HandleStopChainRun},
		{Pattern: "POST /hybridflow-runner/chain-runs/resume", Handler: s.HandleResumeChainRun},
		{Pattern: "POST /hybridflow-runner/chain-runs/restart", Handler: s.HandleRestartChainRun},
		{Pattern: "POST /hybridflow-runner/chain-runs/forget", Handler: s.HandleForgetChainRun},
		{Pattern: "GET /hybridflow-runner/runner", Handler: s.HandleRunnerIdentity},
	})
	// The runs under the name they had before the workflow run was renamed a chain run. Same
	// handlers behind both, like the legacy prefixes: a script or a bookmarked curl written
	// against the old paths keeps working, and nothing on the HTTP surface announces a version
	// that would tell it to move.
	routes = append(routes, aliased([]core.Route{
		{Pattern: "GET /hybridflow-runner/workflow-runs", Handler: s.HandleGetChainRuns},
		{Pattern: "POST /hybridflow-runner/workflow-runs/play", Handler: s.HandlePlayChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/stop", Handler: s.HandleStopChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/resume", Handler: s.HandleResumeChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/restart", Handler: s.HandleRestartChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/forget", Handler: s.HandleForgetChainRun},
	})...)
	if s.offersUsage() {
		routes = append(routes, aliased([]core.Route{
			{Pattern: "GET /hybridflow-runner/usage", Handler: s.HandleUsage}})...)
	}
	if s.offersOptions() {
		routes = append(routes, aliased([]core.Route{
			{Pattern: "GET /hybridflow-runner/options", Handler: s.HandleOptions}})...)
	}
	if s.login != nil {
		routes = append(routes, aliased([]core.Route{
			{Pattern: "GET /hybridflow-runner/auth/status", Handler: s.HandleAuthStatus},
			{Pattern: "POST /hybridflow-runner/auth/login/start", Handler: s.HandleLoginStart},
			{Pattern: "POST /hybridflow-runner/auth/login/code", Handler: s.HandleLoginCode},
			{Pattern: "POST /hybridflow-runner/auth/login/cancel", Handler: s.HandleLoginCancel}})...)
	}
	if s.offersAPIKeyLogin() {
		routes = append(routes, aliased([]core.Route{
			{Pattern: "POST /hybridflow-runner/auth/{agent}/key", Handler: s.HandleAPIKeyLogin}})...)
	}
	if s.offersDeviceLogin() {
		routes = append(routes, aliased([]core.Route{
			{Pattern: "POST /hybridflow-runner/auth/{agent}/login/start", Handler: s.HandleDeviceLoginStart},
			{Pattern: "GET /hybridflow-runner/auth/{agent}/login/status", Handler: s.HandleDeviceLoginStatus},
			{Pattern: "POST /hybridflow-runner/auth/{agent}/login/cancel", Handler: s.HandleDeviceLoginCancel}})...)
	}
	// The socket, on every one of its paths. It is not aliased through the prefix rule above because
	// its old names are not a prefix of anything — `/ws/hybridflow-runner`, `/ws/agent` and
	// `/ws/claude` are three whole paths.
	for _, path := range SocketPaths() {
		routes = append(routes, core.Route{Pattern: path, Handler: s.hub.handle})
	}
	return routes
}

// aliased is every route it is given, once under each prefix: `/hybridflow-runner` first, then every
// legacy one, the same handler behind all of them. Written as one function rather than as further
// literals so the lists cannot drift — an endpoint added under the new prefix gets its aliases by
// construction, which is what an alias set nobody remembers to update is otherwise worth.
func aliased(routes []core.Route) []core.Route {
	out := make([]core.Route, 0, len(routes)*(len(legacyHTTPPrefixes)+1))
	for _, route := range routes {
		out = append(out, route)
		for _, legacy := range legacyHTTPPrefixes {
			out = append(out, core.Route{
				Pattern: strings.Replace(route.Pattern, " "+httpPrefix+"/", " "+legacy+"/", 1),
				Handler: route.Handler,
			})
		}
	}
	return out
}
