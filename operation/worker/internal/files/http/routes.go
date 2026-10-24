package fileshttp

import (
	"kiao/worker/internal/core/http"
)

// Routes is this half's HTTP surface: browsing and changing the store, its configuration
// documents, its actions, and Source Control. It reads as one table because that is what it is —
// the questions a client may ask of a store, and the answers this program mounts for them.
func (s *Service) Routes() []httpkit.Route {
	return []httpkit.Route{
		// File store
		{Pattern: "GET /getFile", Handler: s.HandleGetFile},
		{Pattern: "POST /upload", Handler: s.HandleUpload},
		{Pattern: "PUT /update", Handler: s.HandleUpdate},
		{Pattern: "DELETE /delete", Handler: s.HandleDelete},
		{Pattern: "POST /deleteBatch", Handler: s.HandleDeleteBatch},
		{Pattern: "GET /list", Handler: s.HandleList},
		{Pattern: "GET /listRecursive", Handler: s.HandleListRecursive},
		{Pattern: "GET /info", Handler: s.HandleInfo},
		{Pattern: "POST /createFolder", Handler: s.HandleCreateFolder},
		{Pattern: "POST /rename", Handler: s.HandleRename},
		{Pattern: "POST /moveBatch", Handler: s.HandleMoveBatch},
		{Pattern: "POST /copyBatch", Handler: s.HandleCopyBatch},
		{Pattern: "GET /search", Handler: s.HandleSearch},
		{Pattern: "POST /reindex", Handler: s.HandleReindex},
		{Pattern: "POST /staging", Handler: s.HandleCreateStaging},
		{Pattern: "DELETE /staging", Handler: s.HandleDiscardStaging},
		{Pattern: "POST /unzip", Handler: s.HandleUnzip},
		{Pattern: "GET /fileOptimizations", Handler: s.HandleFileOptimizations},
		{Pattern: "POST /deduplicate", Handler: s.HandleDeduplicate},
		{Pattern: "GET /diskUsage", Handler: s.HandleDiskUsage},
		{Pattern: "GET /storeInfo", Handler: s.HandleStoreInfo},

		// Configuration documents (see configdocs.go) — the state directory, not the file store
		{Pattern: "GET /config/{name}", Handler: s.HandleGetConfigDoc},
		{Pattern: "PUT /config/{name}", Handler: s.HandlePutConfigDoc},

		// File actions (registered externally; see actions.go)
		{Pattern: "GET /actions", Handler: s.HandleListActions},
		{Pattern: "POST /actions/run", Handler: s.HandleRunAction},

		// A video's segments saved as files of their own, by ffmpeg (see media.go)
		{Pattern: "POST /media/saveSegments", Handler: s.HandleSaveSegments},
		{Pattern: "GET /media/jobs/{id}", Handler: s.HandleGetMediaJob},
		{Pattern: "DELETE /media/jobs/{id}", Handler: s.HandleStopMediaJob},

		// Git (Source Control)
		{Pattern: "GET /git/status", Handler: s.HandleGitStatus},
		{Pattern: "POST /git/fetch", Handler: s.HandleGitFetch},
		{Pattern: "GET /git/branches", Handler: s.HandleGitBranches},
		{Pattern: "POST /git/checkout", Handler: s.HandleGitCheckout},
		{Pattern: "POST /git/createBranch", Handler: s.HandleGitCreateBranch},
		{Pattern: "POST /git/stage", Handler: s.HandleGitStage},
		{Pattern: "POST /git/unstage", Handler: s.HandleGitUnstage},
		{Pattern: "POST /git/stageBatch", Handler: s.HandleGitStageBatch},
		{Pattern: "POST /git/unstageBatch", Handler: s.HandleGitUnstageBatch},
		{Pattern: "POST /git/stageAll", Handler: s.HandleGitStageAll},
		{Pattern: "POST /git/unstageAll", Handler: s.HandleGitUnstageAll},
		{Pattern: "POST /git/revert", Handler: s.HandleGitRevert},
		{Pattern: "POST /git/revertAll", Handler: s.HandleGitRevertAll},
		{Pattern: "POST /git/commit", Handler: s.HandleGitCommit},
		{Pattern: "POST /git/consolidate", Handler: s.HandleGitConsolidate},
		{Pattern: "POST /git/push", Handler: s.HandleGitPush},
		{Pattern: "POST /git/pull", Handler: s.HandleGitPull},
		{Pattern: "GET /git/original", Handler: s.HandleGitOriginal},
		{Pattern: "GET /git/working", Handler: s.HandleGitWorking},
		{Pattern: "POST /git/save", Handler: s.HandleGitSave},
	}
}
