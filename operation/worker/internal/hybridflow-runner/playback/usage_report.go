package playback

import (
	"fmt"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/turns"
	"time"
)

// ReportTurnUsage queues a settled turn's bill on its AI flow node and returns filing failures.
// Interactive turns and turns without reported usage have no task bill.
func (r *ChainRunner) ReportTurnUsage(job *turns.Turn) error {
	if r == nil || r.Boards == nil || job == nil {
		return nil
	}
	job.Mu.Lock()
	board, flowNodeID := job.Board, job.FlowNodeID
	runID, model := job.RunID, job.Model
	billed, at := job.Usage, job.FinishedAt
	job.Mu.Unlock()
	if board == "" || flowNodeID == "" || billed == nil {
		return nil
	}
	if at.IsZero() {
		at = time.Now()
	}
	report := pkgBoards.NewUsageReport(runID, model, billed, at)
	if err := r.Boards.ReportUsage(board, flowNodeID, *report); err != nil {
		return fmt.Errorf("report turn usage (board %q, flow node %q, run %q): %w", board, flowNodeID, runID, err)
	}
	return nil
}
