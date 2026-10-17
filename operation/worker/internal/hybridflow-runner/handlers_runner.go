package hybridflowrunner

import (
	"net/http"

	"kiao/worker/internal/core"
)

// The environment overrides runner.json for the process lifetime.
const runnerSourceEnv = "env"

const runnerSourceFile = "file"

// With no identity, unpinned cards may play but pinned cards are refused.
const runnerSourceNone = "none"

type runnerIdentityDto struct {
	RunnerID string `json:"runnerId"`
	Source   string `json:"source"`
}

// HandleRunnerIdentity serves GET /hybridflow-runner/runner with the live identity
// and its source; clients use the source to disable edits when the environment wins.
func (s *Service) HandleRunnerIdentity(w http.ResponseWriter, r *http.Request) {
	id := ""
	source := runnerSourceNone
	if s.cfg != nil {
		id = s.cfg.currentRunnerID()
		switch {
		case s.cfg.runnerFromEnv:
			source = runnerSourceEnv
		case id != "":
			source = runnerSourceFile
		}
	}
	core.WriteJSON(w, http.StatusOK, runnerIdentityDto{RunnerID: id, Source: source})
}
