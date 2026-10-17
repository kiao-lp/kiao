package hybridflowrunner

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"kiao/worker/internal/core"
)

// ── The boards, over HTTP ─────────────────────────────────────────────────────
//
// BoardStore against `operation/hybridflow-store`. Each operation is one call that changes one
// field of one card, and the board comes back after it for the run's chain.
//
// **Nothing here decodes a shape of its own.** The service publishes a card under the field
// names the board owns — `type`, `tags`, `body`, `settings`, `at`, `spot`, `status`, `chat`,
// `onSuccess` — so a board off the wire is read by the reader this package already had
// (board_content.go), forgiving parts included. That is what keeps one definition of what a card
// is across two services and a browser.
//
// ── the credential ────────────────────────────────────────────────────────────
//
// A run lasts hours; the token the person clicking Play arrived with lasts minutes. So a run cannot
// carry the user's credential, and this service needs one of its own.
//
// It presents a **service token** the deployment configures on both sides, which is the same shape
// worker already uses for the credentials it issues to its own turns (see
// core.TurnTokenRegistry): a bearer the other end accepts beside its Keycloak JWTs, and nothing
// negotiated. What it does *not* lose is who the work belongs to — every call names the run's owner
// in `X-Kiao-Actor`, and the service records that as the actor of the change. So a card moved by a
// run still says whose run it was, on a board somebody else is reading.
//
// A caller bearing a JWT may not name an actor: it is who its token says it is. Only the service
// token carries the right to speak for somebody, which is what makes the header auditable rather
// than a way past the login.

// hybridflowStore is BoardStore over the hybridflow-store HTTP API.
type hybridflowStore struct {
	base   string
	token  string
	client *http.Client
}

// hybridflowCallTimeout bounds one call. Short, because every one of them is a single-row read or
// write on a database on the same network: a call that takes longer than this is a service that is
// down, and a run is better told so than left holding a card while it waits.
const hybridflowCallTimeout = 15 * time.Second

func newHybridflowStore(base, token string) *hybridflowStore {
	return &hybridflowStore{
		base:   strings.TrimRight(base, "/"),
		token:  token,
		client: &http.Client{Timeout: hybridflowCallTimeout},
	}
}

var _ BoardStore = (*hybridflowStore)(nil)

// boardPayload is what the service answers a board with. Only the cards are read: the board's
// own row carries a name, a handle and a revision the runner has no use for, and the change cursor
// is for a client that watches rather than one that re-reads at every step.
type boardPayload struct {
	FlowNodes []flowNode `json:"flowNodes"`
}

func (p boardPayload) board() *boardContent {
	return &boardContent{FlowNodes: p.FlowNodes}
}

func (s *hybridflowStore) Board(handle string) (*boardContent, error) {
	return s.readBoard(handle, "")
}

func (s *hybridflowStore) Start(handle, flowNodeID, runID string) (*boardContent, error) {
	return s.change(handle, runID, http.MethodPost, s.flowNodePath(handle, flowNodeID)+"/play",
		map[string]string{"run": runID})
}

func (s *hybridflowStore) Reopen(handle, flowNodeID, runID string) (*boardContent, error) {
	return s.change(handle, runID, http.MethodPatch, s.flowNodePath(handle, flowNodeID),
		map[string]string{"status": flowNodeStatusRunning})
}

func (s *hybridflowStore) Hold(handle, flowNodeID, runID string) (*boardContent, error) {
	return s.change(handle, runID, http.MethodPatch, s.flowNodePath(handle, flowNodeID),
		map[string]string{"status": flowNodeStatusWaitingRefresh})
}

func (s *hybridflowStore) Finish(handle, flowNodeID, runID, status string) (*boardContent, error) {
	return s.change(handle, runID, http.MethodPost, s.flowNodePath(handle, flowNodeID)+"/played",
		map[string]string{"run": runID, "status": status})
}

func (s *hybridflowStore) Chat(handle, flowNodeID, chat string) (*boardContent, error) {
	return s.change(handle, "", http.MethodPatch, s.flowNodePath(handle, flowNodeID),
		map[string]string{"chat": chat})
}

// Ready offers the card a turn again. The claim is the settle's to free — this only says the
// card is to be played — so no run travels as the actor: there is no run yet to name.
func (s *hybridflowStore) Ready(handle, flowNodeID string) (*boardContent, error) {
	return s.change(handle, "", http.MethodPatch, s.flowNodePath(handle, flowNodeID),
		map[string]string{"status": flowNodeStatusReady})
}

// usagePayload is one turn's bill as the store files it. The names are the wire's — camelCase,
// like every other payload here — and the zeros stay home: the store reads an absent figure as
// none reported.
type usagePayload struct {
	ID               string `json:"id,omitempty"`
	Run              string `json:"run,omitempty"`
	Model            string `json:"model,omitempty"`
	ReportedAt       string `json:"reportedAt,omitempty"`
	InputTokens      int64  `json:"inputTokens,omitempty"`
	OutputTokens     int64  `json:"outputTokens,omitempty"`
	CacheReadTokens  int64  `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64  `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int64  `json:"reasoningTokens,omitempty"`
	CostUsdMicros    *int64 `json:"costUsdMicros,omitempty"`
}

// ReportUsage files what a turn cost on the card it ran for: one call, and no board read back
// after it — the report changes no card, so there is no chain to work out. The run travels as
// the actor, so the filing is said in the run's name where anything asks.
func (s *hybridflowStore) ReportUsage(handle, flowNodeID string, report UsageReport) error {
	payload := usagePayload{
		ID: report.ID, Run: report.RunID, Model: report.Model,
		InputTokens: report.InputTokens, OutputTokens: report.OutputTokens,
		CacheReadTokens: report.CacheReadTokens, CacheWriteTokens: report.CacheWriteTokens,
		ReasoningTokens: report.ReasoningTokens, CostUsdMicros: report.CostUsdMicros,
	}
	if !report.ReportedAt.IsZero() {
		payload.ReportedAt = report.ReportedAt.UTC().Format(time.RFC3339)
	}
	_, err := s.request(http.MethodPost, s.flowNodePath(handle, flowNodeID)+"/usage", report.RunID, payload)
	return err
}

// Drop is Finish with the refusal swallowed. The service refuses a release from a run that does not
// hold the card, which is the guard this operation *is* — so a 409 here is the answer rather than a
// failure, and the board is read back so the caller still gets the chain.
func (s *hybridflowStore) Drop(handle, flowNodeID, runID string) (*boardContent, error) {
	board, err := s.Finish(handle, flowNodeID, runID, flowNodeStatusInterrupted)
	var refused *core.HTTPError
	if errors.As(err, &refused) && (refused.Status == http.StatusConflict || refused.Status == http.StatusNotFound) {
		return s.readBoard(handle, runID)
	}
	return board, err
}

func (s *hybridflowStore) SettleRun(runID string) (int, error) {
	body, err := s.request(http.MethodPost, "/runs/"+url.PathEscape(runID)+"/settle", runID, nil)
	if err != nil {
		return 0, err
	}
	var out struct {
		Settled int `json:"settled"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return 0, fmt.Errorf("the settle answer could not be read: %w", err)
	}
	return out.Settled, nil
}

// managedAgent is one managed agent as the hybridflow-store answers it: the named definition of
// what plays a flow node. Only the fields a play runs on are read — the engine, the model and the
// standing instructions — and the rest of the answer is left unread.
type managedAgent struct {
	Name         string `json:"name"`
	Platform     string `json:"platform"`
	Model        string `json:"model"`
	Instructions string `json:"instructions"`
}

// Agent reads one managed agent, by id. A 404 is answered as ErrAgentUnknown rather than as an
// HTTP error, because the caller treats "no such agent" as a fork — a card written before managed
// agents names an engine rather than an id — and not as a failure.
func (s *hybridflowStore) Agent(id string) (*managedAgent, error) {
	body, err := s.request(http.MethodGet, "/agents/"+url.PathEscape(id), "", nil)
	if err != nil {
		var refused *core.HTTPError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return nil, ErrAgentUnknown
		}
		return nil, err
	}
	var out managedAgent
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("the agent could not be read: %w", err)
	}
	return &out, nil
}

// managedRunner is one runner as the hybridflow-store answers it. Only the name is read: the
// refusal a pinned card is met with names the runner it wanted, and an id nobody reads is no
// sentence.
type managedRunner struct {
	Name string `json:"name"`
}

// Runner reads one runner, by id. A 404 is answered as ErrRunnerUnknown rather than as an HTTP
// error, because the caller treats "no such runner" as a name it cannot resolve — the refusal
// then carries the id — and not as a failure.
func (s *hybridflowStore) Runner(id string) (*managedRunner, error) {
	body, err := s.request(http.MethodGet, "/runners/"+url.PathEscape(id), "", nil)
	if err != nil {
		var refused *core.HTTPError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return nil, ErrRunnerUnknown
		}
		return nil, err
	}
	var out managedRunner
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("the runner could not be read: %w", err)
	}
	return &out, nil
}

// Heartbeat tells the store this runner is alive: it stamps the runner's last seen with now. The
// body is empty — the id in the path is the whole of the request — and a 404 is the store's way
// of saying the runner has gone, which the caller reports rather than retries into.
func (s *hybridflowStore) Heartbeat(id string) error {
	_, err := s.request(http.MethodPost, "/runners/"+url.PathEscape(id)+"/heartbeat", "", nil)
	return err
}

func (s *hybridflowStore) boardPath(handle string) string {
	return "/boards/" + url.PathEscape(handle)
}

func (s *hybridflowStore) flowNodePath(handle, flowNodeID string) string {
	return s.boardPath(handle) + "/flow-nodes/" + url.PathEscape(flowNodeID)
}

// The paths the turn's boards proxy forwards to. One helper per shape so the escaping lives in
// one place: the handlers name the shape, never the slashes.
func (s *hybridflowStore) classPath(handle, classID string) string {
	return s.boardPath(handle) + "/flow-node-classes/" + url.PathEscape(classID)
}

func (s *hybridflowStore) classVersionPath(handle, classID, versionID string) string {
	return s.classPath(handle, classID) + "/versions/" + url.PathEscape(versionID)
}

func (s *hybridflowStore) workflowPath(handle, workflowID string) string {
	return s.boardPath(handle) + "/workflows/" + url.PathEscape(workflowID)
}

func (s *hybridflowStore) workflowClassPath(handle, workflowClassID string) string {
	return s.boardPath(handle) + "/workflow-classes/" + url.PathEscape(workflowClassID)
}

// change makes the write and then reads the board back, which is what the run's chain is worked out
// from. Two calls — a write and a read — and each of them a single row.
//
// The read is **after** the write and not part of it: a write answers with the card it changed, and
// a chain is a fact about the whole board, including the cards somebody has moved since.
func (s *hybridflowStore) change(handle, actor, method, path string, payload any) (*boardContent, error) {
	if _, err := s.request(method, path, actor, payload); err != nil {
		return nil, err
	}
	return s.readBoard(handle, actor)
}

func (s *hybridflowStore) readBoard(handle, actor string) (*boardContent, error) {
	body, err := s.request(http.MethodGet, s.boardPath(handle), actor, nil)
	if err != nil {
		return nil, err
	}
	var out boardPayload
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("the board could not be read: %w", err)
	}
	return out.board(), nil
}

// maxBoardBytes bounds an answer. A board's cards are the length of it and are measured in
// kilobytes; eight megabytes is room for a very long one and a refusal for anything that is not a
// board.
const maxBoardBytes = 8 << 20

func (s *hybridflowStore) request(method, path, actor string, payload any) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, s.base+path, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	if actor != "" {
		req.Header.Set("X-Kiao-Actor", actor)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		// A service that cannot be reached is reported as one, not as a missing board: a run told
		// "no such flow node" would give up on a card that is perfectly well there.
		return nil, &core.HTTPError{
			Status: http.StatusServiceUnavailable,
			Msg:    "the hybridflow store could not be reached: " + err.Error(),
		}
	}
	defer resp.Body.Close()
	answer, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBoardBytes))
	if resp.StatusCode >= 300 {
		// The status is carried through rather than flattened. The runner acts on two of them: a 409
		// is another run holding the card, which ends a chain politely, and a 404 is a card somebody
		// deleted while the turn ran, which ends it too. Anything else is a failure worth saying.
		return nil, &core.HTTPError{Status: resp.StatusCode, Msg: hybridflowError(answer, resp.Status)}
	}
	if readErr != nil {
		return nil, fmt.Errorf("the hybridflow store answer could not be read: %w", readErr)
	}
	return answer, nil
}

// hybridflowError is the message the other service sent, or its status line when it sent none worth
// showing. The wording reaches the panel, so it is the other end's sentence and not a paraphrase.
func hybridflowError(body []byte, status string) string {
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &out); err == nil && strings.TrimSpace(out.Error) != "" {
		return out.Error
	}
	return "the hybridflow store answered " + status
}
