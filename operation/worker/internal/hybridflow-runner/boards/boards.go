package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/http"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"path/filepath"
	"strings"
)

// BoardStore uses flow node/field-level writes to avoid overwriting concurrent edits.
// Handles are opaque board ids or slugs. Writes return a fresh board for chain resolution;
// over HTTP, this is a separate read after the write.
// runID guards ownership so a late result cannot mark a flow node taken by another run.
type BoardStore interface {
	// Board rereads the live board; only ids survive an await.
	Board(handle string) (*BoardContent, error)
	Schema(id string) (json.RawMessage, error)
	// Start claims the flow node, refusing if another run holds it.
	// A gateway reached from a predecessor checks for new inputs before firing again.
	Start(handle, flowNodeID, runID string, afterPredecessor ...bool) (*BoardContent, error)
	// Reopen resumes a held flow node after a usage limit lifts.
	Reopen(handle, flowNodeID, runID string) (*BoardContent, error)
	// Hold records the usage-limit wait; the interrupted turn stays in the chat.
	Hold(handle, flowNodeID, runID string) (*BoardContent, error)
	// Finish atomically stores the status, structured export and workflow values under the run claim.
	Finish(handle, flowNodeID, runID string, result PlayResult) (*BoardContent, error)
	// PassLimiter completes one pass and returns the successor selected by the live store.
	PassLimiter(ctx context.Context, handle, flowNodeID, runID string, revision int64, output json.RawMessage) (*FlowNode, string, error)
	// Chat persists the conversation reference beyond the play.
	Chat(handle, flowNodeID, chat string) (*BoardContent, error)
	// Drop marks interrupted only if runID still holds the flow node; otherwise it is a no-op.
	// Teardown may follow an earlier finish or a new owner taking the flow node.
	Drop(handle, flowNodeID, runID string) (*BoardContent, error)
	// Ready makes an interrupted flow node replayable after releasing its run.
	Ready(handle, flowNodeID string) (*BoardContent, error)
	Todo(handle, flowNodeID string) (*BoardContent, error)
	// ReportUsage records turn cost without changing the flow node or returning a board.
	// With a disk spool, success confirms persistence; disk errors reach the caller.
	// Sending is asynchronous and retains the report id across retries.
	ReportUsage(handle, flowNodeID string, report UsageReport) error
	// SettleRun releases all flow nodes still held by a run after a process restart.
	// A spooled release returns zero only after the queue is saved successfully.
	SettleRun(runID string) (int, error)
}

type PlayResult struct {
	Status   string          `json:"status"`
	Output   json.RawMessage `json:"output,omitempty"`
	Workflow *WorkflowUpdate `json:"workflow,omitempty"`
}

// newBoardStore returns nil without a hybridflow-store URL; Play and /boards then return 503.
func NewBoardStore(cfg *runnerconfig.Config) (BoardStore, string) {
	if cfg != nil && cfg.HybridflowURL != "" {
		var spoolPath string
		if cfg.Config != nil && strings.TrimSpace(cfg.StatePath) != "" {
			spoolPath = filepath.Join(cfg.StatePath, HybridflowSpoolFileName)
		}
		inner := NewHybridflowStore(cfg.HybridflowURL, cfg.HybridflowToken)
		inner.ResourceURL, inner.ResourceToken = cfg.AgenticURL, cfg.AgenticToken
		return NewSpoolingHybridflowStore(inner, spoolPath),
			fmt.Sprintf("hybridflow-store at %s", cfg.HybridflowURL)
	}
	return nil, "nowhere: no hybridflow-store is configured"
}

func ErrNoHybridflowStore(what string) *httpkit.HTTPError {
	return &httpkit.HTTPError{Status: http.StatusServiceUnavailable,
		Msg: "this worker names no hybridflow-store (KIAO_WORKER_HYBRIDFLOW_URL is unset), so there " + what}
}
