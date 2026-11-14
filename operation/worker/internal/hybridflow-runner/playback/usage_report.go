package playback

import (
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/turns"
	"time"
)

// ReportTurnUsage queues a settled turn's bill on its AI card, for every harness.
// Interactive turns and turns without reported usage have no task bill.
func (r *ChainRunner) ReportTurnUsage(job *turns.Turn) {
	if r == nil || r.Boards == nil || job == nil {
		return
	}
	job.Mu.Lock()
	board, flowNodeID := job.Board, job.FlowNodeID
	runID, model := job.RunID, job.Model
	billed, at := job.Usage, job.FinishedAt
	job.Mu.Unlock()
	if board == "" || flowNodeID == "" || billed == nil {
		return
	}
	if at.IsZero() {
		at = time.Now()
	}
	report := pkgBoards.NewUsageReport(runID, model, billed, at)
	if err := r.Boards.ReportUsage(board, flowNodeID, *report); err != nil {
		pkgBoards.LogChainRun.Warn("the turn's usage could not be reported",
			"board", board, "flowNode", flowNodeID, "run", runID, "error", err)
	}
}
