package boards

import (
	"fmt"
	"kiao/worker/internal/core/http"
	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
	"net/http"
	"path/filepath"
	"strings"
)

// BoardStore uses card/field-level writes to avoid overwriting concurrent edits.
// Handles are opaque board ids or slugs. Writes return a fresh board for chain resolution;
// over HTTP, this is a separate read after the write.
// runID guards ownership so a late result cannot mark a card taken by another run.
type BoardStore interface {
	// Board rereads the live board; only ids survive an await.
	Board(handle string) (*BoardContent, error)
	// Start claims the card, refusing if another run holds it.
	Start(handle, flowNodeID, runID string) (*BoardContent, error)
	// Reopen resumes a held card after a usage limit lifts.
	Reopen(handle, flowNodeID, runID string) (*BoardContent, error)
	// Hold records the usage-limit wait; the interrupted turn stays in the chat.
	Hold(handle, flowNodeID, runID string) (*BoardContent, error)
	// Finish sets status without changing the task description; output stays in the chat.
	Finish(handle, flowNodeID, runID, status string) (*BoardContent, error)
	// Chat persists the conversation reference beyond the play.
	Chat(handle, flowNodeID, chat string) (*BoardContent, error)
	// Drop marks interrupted only if runID still holds the card; otherwise it is a no-op.
	// Teardown may follow an earlier finish or a new owner taking the card.
	Drop(handle, flowNodeID, runID string) (*BoardContent, error)
	// Ready makes an interrupted card replayable after releasing its run.
	Ready(handle, flowNodeID string) (*BoardContent, error)
	// ReportUsage records turn cost without changing the card or returning a board.
	// The spooling store queues it without waiting on the network, so billing cannot delay play.
	ReportUsage(handle, flowNodeID string, report UsageReport) error
	// SettleRun releases all cards still held by a run after a process restart.
	SettleRun(runID string) (int, error)
}

// newBoardStore returns nil without a hybridflow-store URL; Play and /boards then return 503.
func NewBoardStore(cfg *runnerconfig.Config) (BoardStore, string) {
	if cfg != nil && cfg.HybridflowURL != "" {
		var spoolPath string
		if cfg.Config != nil && strings.TrimSpace(cfg.StatePath) != "" {
			spoolPath = filepath.Join(cfg.StatePath, HybridflowSpoolFileName)
		}
		inner := NewHybridflowStore(cfg.HybridflowURL, cfg.HybridflowToken)
		return NewSpoolingHybridflowStore(inner, spoolPath),
			fmt.Sprintf("hybridflow-store at %s", cfg.HybridflowURL)
	}
	return nil, "nowhere: no hybridflow-store is configured"
}

func ErrNoHybridflowStore(what string) *httpkit.HTTPError {
	return &httpkit.HTTPError{Status: http.StatusServiceUnavailable,
		Msg: "this worker names no hybridflow-store (KIAO_WORKER_HYBRIDFLOW_URL is unset), so there " + what}
}
