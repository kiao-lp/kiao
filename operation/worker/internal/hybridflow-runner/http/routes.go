package runnerhttp

import (
	"kiao/worker/internal/core/http"
	"strings"
)

// SocketPath is the primary turn socket path. SocketPaths includes compatibility aliases
// so routing and trace exclusions agree. Every path uses hello.protocolVersion;
// a mismatched client must reload.
const SocketPath = "/ws/hybridflow-runner"

// legacySocketPaths lists compatibility aliases for the turn socket.
var legacySocketPaths = []string{"/ws/harness", "/ws/claude"}

// SocketPaths is every path the turn socket answers on, for the middleware that must not trace them.
func SocketPaths() []string {
	paths := make([]string, 0, len(legacySocketPaths)+1)
	paths = append(paths, SocketPath)
	return append(paths, legacySocketPaths...)
}

// httpPrefix is the primary runner REST prefix. legacyHTTPPrefixes aliases every route
// to the same handler and payload. HTTP has no version handshake, so existing client paths
// must keep working.
const httpPrefix = "/hybridflow-runner"

// legacyHTTPPrefixes lists compatibility aliases for runner REST routes.
var legacyHTTPPrefixes = []string{"/harnesses", "/claude"}

// Routes is this half's HTTP surface: the pattern net/http routes on, and what answers it. The
// program mounts them — nothing is served that it did not mount — and mounts the other half's the
// same way.
//
// Four of them are mounted only when a harness answers the side port behind them (driver.go): the
// quota, the prompt's options, and the two sign-ins. A deployment whose harnesses have no quota to
// report leaves `GET /hybridflow-runner/usage` unmounted rather than serving an endpoint that cannot work —
// the same shape a deployment with sign-in switched off already has.
//
// The Claude sign-in is the *default* harness's; the quota, the options and the API-key sign-in
// answer **per harness**, and each is mounted as long as one harness has something to say (see
// usage.go, api.go and muse_login.go). The quota had to follow the options there the moment a
// second harness grew one: an account is a harness's, and a panel showing several conversations at
// once shows several accounts with them — and the sign-in followed for the same reason the moment
// a second harness grew one of its own.
func (s *Service) Routes() []httpkit.Route {
	routes := aliased([]httpkit.Route{
		{Pattern: "GET /hybridflow-runner/profiles", Handler: s.HandlePiProfiles},
		{Pattern: "PUT /hybridflow-runner/profiles", Handler: s.HandlePiProfiles},
		{Pattern: "POST /hybridflow-runner/profiles/{id}/diagnostic", Handler: s.HandlePiDiagnostic},
		{Pattern: "POST /hybridflow-runner/profiles/{id}/connection", Handler: s.HandlePiConnection},
		{Pattern: "PUT /hybridflow-runner/profile-secrets/{id}", Handler: s.HandlePiSecret},
		{Pattern: "GET /hybridflow-runner/profile-secrets", Handler: s.HandlePiSecrets},
		{Pattern: "GET /hybridflow-runner/profile-secrets/{id}", Handler: s.HandlePiSecret},
		{Pattern: "DELETE /hybridflow-runner/profile-secrets/{id}", Handler: s.HandlePiSecret},
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
		{Pattern: "GET /hybridflow-runner/schema-values", Handler: s.HandleListSchemaValues},
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
		{Pattern: "POST /hybridflow-runner/agents/{id}/publish", Handler: s.HandlePublishAgent},
		{Pattern: "GET /hybridflow-runner/agents/{id}/versions", Handler: s.HandleAgentVersions},
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
	// workflow-runs aliases chain-runs for HTTP clients using that spelling.
	// Both sets use the same handlers and prefix aliases.
	routes = append(routes, aliased([]httpkit.Route{
		{Pattern: "GET /hybridflow-runner/workflow-runs", Handler: s.HandleGetChainRuns},
		{Pattern: "POST /hybridflow-runner/workflow-runs/play", Handler: s.HandlePlayChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/stop", Handler: s.HandleStopChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/resume", Handler: s.HandleResumeChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/restart", Handler: s.HandleRestartChainRun},
		{Pattern: "POST /hybridflow-runner/workflow-runs/forget", Handler: s.HandleForgetChainRun},
	})...)
	if s.offersUsage() {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "GET /hybridflow-runner/usage", Handler: s.HandleUsage}})...)
	}
	if s.offersOptions() {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "GET /hybridflow-runner/options", Handler: s.HandleOptions}})...)
	}
	if s.offersAuth() {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "GET /hybridflow-runner/auth/status", Handler: s.HandleAuthStatus}})...)
	}
	if s.login != nil {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "POST /hybridflow-runner/auth/login/start", Handler: s.HandleLoginStart},
			{Pattern: "POST /hybridflow-runner/auth/login/code", Handler: s.HandleLoginCode},
			{Pattern: "POST /hybridflow-runner/auth/login/cancel", Handler: s.HandleLoginCancel}})...)
	}
	if s.offersAPIKeyLogin() {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "POST /hybridflow-runner/auth/{harness}/key", Handler: s.HandleAPIKeyLogin}})...)
	}
	if s.offersDeviceLogin() {
		routes = append(routes, aliased([]httpkit.Route{
			{Pattern: "POST /hybridflow-runner/auth/{harness}/login/start", Handler: s.HandleDeviceLoginStart},
			{Pattern: "GET /hybridflow-runner/auth/{harness}/login/status", Handler: s.HandleDeviceLoginStatus},
			{Pattern: "POST /hybridflow-runner/auth/{harness}/login/cancel", Handler: s.HandleDeviceLoginCancel}})...)
	}
	// The socket, on every one of its paths. It is not aliased through the prefix rule above because
	// its old names are not a prefix of anything — `/ws/hybridflow-runner`, `/ws/harness` and
	// `/ws/claude` are three whole paths.
	for _, path := range SocketPaths() {
		routes = append(routes, httpkit.Route{Pattern: path, Handler: newSocketHandler(s.hub).handle})
	}
	return routes
}

// aliased is every route it is given, once under each prefix: `/hybridflow-runner` first, then every
// legacy one, the same handler behind all of them. Written as one function rather than as further
// literals so the lists cannot drift — an endpoint added under the new prefix gets its aliases by
// construction, which is what an alias set nobody remembers to update is otherwise worth.
func aliased(routes []httpkit.Route) []httpkit.Route {
	out := make([]httpkit.Route, 0, len(routes)*(len(legacyHTTPPrefixes)+1))
	for _, route := range routes {
		out = append(out, route)
		for _, legacy := range legacyHTTPPrefixes {
			out = append(out, httpkit.Route{
				Pattern: strings.Replace(route.Pattern, " "+httpPrefix+"/", " "+legacy+"/", 1),
				Handler: route.Handler,
			})
		}
	}
	return out
}
