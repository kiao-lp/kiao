package playback

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	"kiao/worker/internal/hybridflow-runner/turns"
	"time"
)

// reportTurnUsage files a settled turn's bill on the card it ran for, where there is one to
// file. Interactive turns — no board, no card — and agents whose mapping is not written yet
// file nothing; a turn with no bill files nothing either, which reads as unknown.
//
// It returns with the filing handed off, not with it landed: the store queues the report and
// its sender posts it, so the play loop never waits on the network for it.
func (r *ChainRunner) ReportTurnUsage(job *turns.Turn) {
	if r == nil || r.Boards == nil || job == nil {
		return
	}
	job.Mu.Lock()
	agent, board, flowNodeID := job.AgentName, job.Board, job.FlowNodeID
	runID, model := job.RunID, job.Model
	billed, at := job.Usage, job.FinishedAt
	job.Mu.Unlock()
	if (agent != agentapi.AgentMuse && agent != agentapi.AgentCodex) || board == "" || flowNodeID == "" || billed == nil {
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
