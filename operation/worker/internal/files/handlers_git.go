package files

import (
	"encoding/json"
	"kiao/worker/internal/core"
	"net/http"
)

// gitAt scopes the request to the repository the browsed folder belongs to. Every Git endpoint
// carries the folder — including those whose payload is a JSON body — so a client has one thing to
// pass and the whole sequence of calls it makes agrees on which repository, and therefore on what
// its paths are relative to. An absent `folder` is the store root, which is where every command ran
// before folders were taken into account, and is where the close-time commit prompt still runs.
func (s *Service) gitAt(r *http.Request) *GitService {
	return s.git.at(r.URL.Query().Get("folder"))
}

func (s *Service) HandleGitStatus(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).status())
}

func (s *Service) HandleGitFetch(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).fetchAndStatus())
}

func (s *Service) HandleGitBranches(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).branches())
}

func (s *Service) HandleGitCheckout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Branch string `json:"branch"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).checkout(req.Branch))
}

func (s *Service) HandleGitCreateBranch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Branch string `json:"branch"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).createBranch(req.Branch))
}

func (s *Service) HandleGitStage(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).stage(r.URL.Query().Get("path")))
}

func (s *Service) HandleGitUnstage(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).unstage(r.URL.Query().Get("path")))
}

func (s *Service) HandleGitStageBatch(w http.ResponseWriter, r *http.Request) {
	paths, errRes := decodeGitPaths(r)
	if errRes != nil {
		core.WriteJSON(w, http.StatusOK, *errRes)
		return
	}
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).stageBatch(paths))
}

func (s *Service) HandleGitUnstageBatch(w http.ResponseWriter, r *http.Request) {
	paths, errRes := decodeGitPaths(r)
	if errRes != nil {
		core.WriteJSON(w, http.StatusOK, *errRes)
		return
	}
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).unstageBatch(paths))
}

// The tree-wide actions take no paths: the file set is resolved server-side, so the panel sends one
// request whatever the size of the tree.
func (s *Service) HandleGitStageAll(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).stageAll())
}

func (s *Service) HandleGitUnstageAll(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).unstageAll())
}

func (s *Service) HandleGitRevertAll(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).revertAll())
}

// decodeGitPaths reads a batch payload, reporting a bad body the way git failures are reported:
// 200 with ok=false, so callers have a single failure shape to handle.
func decodeGitPaths(r *http.Request) ([]string, *GitResultDto) {
	var req GitPathsRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return nil, &GitResultDto{Ok: false, Output: "Invalid request body"}
	}
	return req.Paths, nil
}

func (s *Service) HandleGitRevert(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).revert(r.URL.Query().Get("path")))
}

func (s *Service) HandleGitCommit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message string `json:"message"`
		Amend   bool   `json:"amend"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).commit(req.Message, req.Amend))
}

// HandleGitConsolidate runs the history-rewriting maintenance operation; it can take minutes on a
// large store, so the client must not treat a slow answer as a failure.
func (s *Service) HandleGitConsolidate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message    string `json:"message"`
		PushRemote bool   `json:"pushRemote"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).consolidate(req.Message, req.PushRemote))
}

func (s *Service) HandleGitPush(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).push())
}

func (s *Service) HandleGitPull(w http.ResponseWriter, r *http.Request) {
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).pull())
}

func (s *Service) HandleGitOriginal(w http.ResponseWriter, r *http.Request) {
	core.WriteText(w, http.StatusOK, s.gitAt(r).originalContent(r.URL.Query().Get("path")))
}

func (s *Service) HandleGitWorking(w http.ResponseWriter, r *http.Request) {
	core.WriteText(w, http.StatusOK, s.gitAt(r).workingContent(r.URL.Query().Get("path")))
}

func (s *Service) HandleGitSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	core.WriteJSON(w, http.StatusOK, s.gitAt(r).saveWorking(req.Path, req.Content))
}
