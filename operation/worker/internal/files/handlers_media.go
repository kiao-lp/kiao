package files

import (
	"encoding/json"
	"net/http"

	"kiao/worker/internal/core"
)

// The handlers of a video's segments saved as files of their own: parse, call, write. What is
// decided is decided in media.go.

// maxSaveBody bounds the body of a save — a path, and a name and two times per segment.
const maxSaveBody = 1 << 20

// HandleSaveSegments serves POST /media/saveSegments: every segment of a video or a recording saved
// as a file of its own, beside it. It answers the job with 202 as soon as it has started — encoding
// takes minutes, and the client polls GET /media/jobs/{id} — and 424 when this machine has no
// ffmpeg able to do it, which is the client's cue to offer to install one.
func (s *Service) HandleSaveSegments(w http.ResponseWriter, r *http.Request) {
	var req SaveSegmentsRequestDto
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSaveBody)).Decode(&req); err != nil {
		core.WriteError(w, r, &core.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	job, err := s.media.save(req)
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusAccepted, job)
}

// HandleGetMediaJob serves GET /media/jobs/{id}: how far the save has got, or how it ended.
func (s *Service) HandleGetMediaJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.media.job(r.PathValue("id"))
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusOK, job)
}

// HandleStopMediaJob serves DELETE /media/jobs/{id}: the save stopped where it stands. It answers
// the job, which reads `stopped` once ffmpeg has gone.
func (s *Service) HandleStopMediaJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.media.stopJob(r.PathValue("id"))
	if err != nil {
		core.WriteError(w, r, err)
		return
	}
	core.WriteJSON(w, http.StatusOK, job)
}
