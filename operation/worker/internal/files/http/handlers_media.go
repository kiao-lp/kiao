package fileshttp

import (
	"encoding/json"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/files/media"
	"net/http"
)

// maxSaveBody bounds the body of a save — a path, and a name and two times per segment.
const maxSaveBody = 1 << 20

// HandleSaveSegments serves POST /media/saveSegments: every segment of a video or a recording saved
// as a file of its own, beside it. It answers the job with 202 as soon as it has started — encoding
// takes minutes, and the client polls GET /media/jobs/{id} — and 424 when this machine has no
// ffmpeg able to do it, which is the client's cue to offer to install one.
func (s *Service) HandleSaveSegments(w http.ResponseWriter, r *http.Request) {
	var req media.SaveSegmentsRequestDto
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSaveBody)).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	job, err := s.media.Save(req)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusAccepted, job)
}

// HandleGetMediaJob serves GET /media/jobs/{id}: how far the save has got, or how it ended.
func (s *Service) HandleGetMediaJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.media.Job(r.PathValue("id"))
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, job)
}

// HandleStopMediaJob serves DELETE /media/jobs/{id}: the save stopped where it stands. It answers
// the job, which reads `stopped` once ffmpeg has gone.
func (s *Service) HandleStopMediaJob(w http.ResponseWriter, r *http.Request) {
	job, err := s.media.StopJob(r.PathValue("id"))
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, job)
}
