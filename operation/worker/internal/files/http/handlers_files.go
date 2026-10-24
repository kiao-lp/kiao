package fileshttp

import (
	"encoding/json"
	"errors"
	"fmt"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/core/http"
	"kiao/worker/internal/core/logging"
	pkgContent "kiao/worker/internal/files/content"
	"kiao/worker/internal/files/search"
	"net/http"
)

// HandleGetFile streams a file, or a zip of a directory, by virtual path. All filesystem access
// goes through the service (openForRead / zipFolder) — the handler never touches the storage
// driver.
//
// A regular file goes out through http.ServeContent, which adds Accept-Ranges, Content-Length,
// Last-Modified and the conditional/range handling that goes with them. That is what a download
// over a mobile connection needs: a total to show progress against, and a Range request to resume
// with after the connection drops. The content type stays the service's own — ServeContent sniffs
// only when the header is unset — so what a client receives is unchanged.
//
// Last-Modified is also the one thing a browser needs to invent a freshness lifetime for a response
// that states none, so the file is served no-cache: a store is edited under the reader's feet, and
// an editor reloading a document — or the disk-sync poll asking whether it changed — must never be
// answered from the cache. It is "revalidate every time", not "do not store", so a conditional
// request still costs a 304 rather than the whole file.
func (s *Service) HandleGetFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	res, err := s.files.OpenForRead(p)
	if err != nil {
		httpkit.WriteError(w, r, err) // invalid path → 400, missing → 404, else 500
		return
	}

	if res.IsDir {
		zipName := res.Name + ".zip"
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", zipName))
		w.Header().Set("Content-Type", "application/zip")
		if err := s.files.ZipFolder(p, w); err != nil {
			logging.LogCtx(r).Error("zip failed", "component", "files", "path", p, "error", err)
		}
		return
	}

	defer res.File.Close()
	w.Header().Set("Content-Type", res.ContentType)
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, res.Name, res.ModTime, res.File)
}

// uploadParseMemoryBytes is what the multipart parser may hold in memory; past it a part goes to a
// temp file the parser removes when the request ends. Small on purpose, and deliberately not
// MaxUploadBytes: that one is the *request* cap, and handing it to ParseMultipartForm would let a
// single 100 MiB upload sit in the heap — ten concurrent ones, a gigabyte — for bytes that are on
// their way to the disk anyway.
const uploadParseMemoryBytes int64 = 1 << 20

// parseUploadForm bounds the request body at MaxUploadBytes, then parses the multipart form.
//
// MaxBytesReader is what makes that limit exist. ParseMultipartForm's own argument is only the
// in-memory threshold — beyond it the parts spill to temp files and the body is read to its end
// however long it turns out to be — so passing MaxUploadBytes there bounded nothing: the ceiling
// was stated in the config and enforced nowhere. In production nginx caps this route
// (client_max_body_size 100M) and the gap never showed; an instance run locally has no such fence,
// and a multipart POST is a simple request that no preflight stands in front of, so a page the
// developer merely visits could stream a body until the disk filled.
//
// The cap covers the whole body, envelope included — what nginx's client_max_body_size and Spring's
// max-request-size both mean by it — so the three limits refuse the same requests.
func (s *Service) parseUploadForm(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	return r.ParseMultipartForm(uploadParseMemoryBytes)
}

// HandleUpload stores a multipart file under the given parent directory.
//
// A body over the cap is a 413 naming the limit, rather than the blunt 500 every other failure
// here gets: it is the one refusal the caller can act on, by sending less.
func (s *Service) HandleUpload(w http.ResponseWriter, r *http.Request) {
	if err := s.parseUploadForm(w, r); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			httpkit.WriteText(w, http.StatusRequestEntityTooLarge,
				"Failed to upload file: the request exceeds the "+filesystem.HumanBytes(s.cfg.MaxUploadBytes)+" limit.")
			return
		}
		httpkit.WriteText(w, http.StatusInternalServerError, "Failed to upload file: "+err.Error())
		return
	}
	parent := r.FormValue("path")
	file, header, err := r.FormFile("file")
	if err != nil {
		httpkit.WriteText(w, http.StatusInternalServerError, "Failed to upload file: "+err.Error())
		return
	}
	defer file.Close()
	abs, err := s.files.Upload(parent, header.Filename, file)
	if err != nil {
		httpkit.WriteError(w, r, err) // invalid path → 400, storage failure → 500
		return
	}
	httpkit.WriteText(w, http.StatusOK, "File uploaded successfully: "+abs)
}

// HandleUpdate overwrites an existing file with multipart content.
//
// Failures deliberately stay 500 (not the core.WriteError taxonomy): the kiao-worker client treats a
// 404 or 500 from /update as "file not there yet" and retries the write as an /upload
// (client.ts update()). Mapping an invalid path to 400 here would break that fallback, so this
// handler keeps its blunt 500 on every error path — including a body over MaxUploadBytes, which
// HandleUpload answers 413. The oversize case still ends where it should: the client retries the
// write as an /upload, and that is the call that names the limit.
func (s *Service) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	if err := s.parseUploadForm(w, r); err != nil {
		httpkit.WriteText(w, http.StatusInternalServerError, "Failed to update file: "+err.Error())
		return
	}
	p := r.URL.Query().Get("path")
	file, _, err := r.FormFile("file")
	if err != nil {
		httpkit.WriteText(w, http.StatusInternalServerError, "Failed to update file: "+err.Error())
		return
	}
	defer file.Close()
	abs, err := s.files.Update(p, file)
	if err != nil {
		httpkit.WriteText(w, http.StatusInternalServerError, "Failed to update file: "+err.Error())
		return
	}
	httpkit.WriteText(w, http.StatusOK, "File updated successfully: "+abs)
}

// HandleDelete removes a file (and subsidiaries) and returns the link-fix report.
func (s *Service) HandleDelete(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	report, err := s.files.Delete(p)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, report)
}

// HandleDeleteBatch removes multiple files (and subsidiaries) and returns link-fix reports.
func (s *Service) HandleDeleteBatch(w http.ResponseWriter, r *http.Request) {
	var req pkgContent.DeleteBatchRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	reports, err := s.files.DeleteBatch(req.Paths)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, reports)
}

// HandleReindex converts the documents at or under the given paths into their sibling indexes.
//
// Answers 200 with a report rather than an error when individual documents fail: pointing at a
// folder of a hundred files and losing the ninety-nine that converted because one is corrupt is
// not a useful answer. Only a path outside the store stops the request.
func (s *Service) HandleReindex(w http.ResponseWriter, r *http.Request) {
	var req search.ReindexRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	result, err := s.files.Reindex(req.Paths)
	if err != nil {
		httpkit.WriteError(w, r, err) // outside the root -> 400
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, result)
}

// HandleCreateStaging opens a staging area for an upload and answers with its path.
//
// It is a POST with no body: the caller has nothing to say about where the files go, because the
// point of a staging area is that nobody has decided that yet.
func (s *Service) HandleCreateStaging(w http.ResponseWriter, r *http.Request) {
	staging, err := s.files.CreateStaging()
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, staging)
}

// HandleDiscardStaging throws a staging area away with everything still in it.
//
// This is what carries out the review's "delete" decision and what answers Cancel, and it is a
// recursive delete with no confirmation in front of it — so the service, and not the caller,
// decides what it may reach: a path that is not one of the directories POST /staging minted is a
// 400 (ErrNotStaging).
func (s *Service) HandleDiscardStaging(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if err := s.files.DiscardStaging(p); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteText(w, http.StatusOK, "Staging area discarded: "+p)
}

// HandleUnzip extracts an archive into its own folder, preserving structure and overwriting.
// With deleteArchive=true the archive itself is removed afterwards. Missing → 404, anything that
// is not a zip or holds an entry that cannot land → 400, past the size caps → 413.
func (s *Service) HandleUnzip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	result, err := s.files.Unzip(q.Get("path"), q.Get("deleteArchive") == "true", s.cfg.MaxUploadBytes*pkgContent.UnzipExpansion)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, result)
}

// HandleList returns the entries of a directory.
func (s *Service) HandleList(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("path")
	files, err := s.files.List(dir)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, files)
}

// HandleListRecursive returns everything under each requested path, capped. `path` may be repeated,
// so a whole selection is one round trip.
func (s *Service) HandleListRecursive(w http.ResponseWriter, r *http.Request) {
	files, truncated, err := s.files.ListRecursive(r.URL.Query()["path"])
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, pkgContent.ScopeResponseDto{Files: files, Truncated: truncated})
}

// HandleInfo returns metadata for a single path (null when missing).
func (s *Service) HandleInfo(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	info, err := s.files.GetFileInfo(p)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, info) // nil pointer serializes to JSON null, matching Optional.empty()
}

// HandleCreateFolder creates a directory.
func (s *Service) HandleCreateFolder(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if err := s.files.CreateFolder(p); err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteText(w, http.StatusOK, "Folder created successfully: "+p)
}

// HandleRename moves a file (and subsidiaries) and returns the link-fix report.
func (s *Service) HandleRename(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	newPath := r.URL.Query().Get("newPath")
	report, err := s.files.RenameFile(p, newPath)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, report)
}

// HandleMoveBatch moves multiple files (and subsidiaries) and returns link-fix reports.
func (s *Service) HandleMoveBatch(w http.ResponseWriter, r *http.Request) {
	var req pkgContent.MoveBatchRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	reports, err := s.files.MoveBatch(req)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, reports)
}

// HandleCopyBatch copies multiple entries (files or whole folders) and returns where each landed.
func (s *Service) HandleCopyBatch(w http.ResponseWriter, r *http.Request) {
	var req pkgContent.CopyBatchRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	results, err := s.files.CopyBatch(req)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, results)
}

// HandleSearch runs a search under a directory. The query is a whole little language, documented in
// searchquery.go and PROTOCOL.md — hence a single `query` parameter and no option flags.
func (s *Service) HandleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	results, truncated, err := s.files.Search(q.Get("path"), q.Get("query"))
	if err != nil {
		httpkit.WriteError(w, r, err) // bad path / non-directory / bad query → 400
		return
	}
	if results == nil {
		results = []search.SearchDto{}
	}
	httpkit.WriteJSON(w, http.StatusOK, search.SearchResponseDto{Results: results, Truncated: truncated})
}

// HandleFileOptimizations reports what the store under `path` is carrying that it need not be: the
// files stored more than once, and the biggest ones. `path` defaults to the store root.
//
// One walk answers both, and it reads the candidates it has to read to be sure — see optimize.go.
// It is therefore a slow endpoint by design, asked for by a person who opened a panel, and never on
// a path a client takes on its own.
func (s *Service) HandleFileOptimizations(w http.ResponseWriter, r *http.Request) {
	result, err := s.files.FileOptimizations(r.URL.Query().Get("path"))
	if err != nil {
		httpkit.WriteError(w, r, err) // outside the root / not a directory → 400
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, result)
}

// HandleDeduplicate reduces a set of identical files to the one at `target`, repairing every
// reference to the ones that go.
//
// The two refusals worth knowing at this layer are 409s rather than 400s, because the request was
// true when the scan produced it: the files are no longer identical, or the target name has been
// taken by a stranger since. Both are the store having moved on under the reader, which is the one
// thing a destructive operation must not do quietly.
func (s *Service) HandleDeduplicate(w http.ResponseWriter, r *http.Request) {
	var req pkgContent.DeduplicateRequestDto
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpkit.WriteError(w, r, &httpkit.HTTPError{Status: http.StatusBadRequest, Msg: "invalid request body"})
		return
	}
	result, err := s.files.Deduplicate(req.Paths, req.Target)
	if err != nil {
		httpkit.WriteError(w, r, err)
		return
	}
	httpkit.WriteJSON(w, http.StatusOK, result)
}

// HandleDiskUsage reports filesystem space figures for the storage root.
func (s *Service) HandleDiskUsage(w http.ResponseWriter, r *http.Request) {
	httpkit.WriteJSON(w, http.StatusOK, s.files.DiskUsage())
}

// HandleStoreInfo reports where the store lives on the host, so a client can turn a root-relative
// path into one the machine running the service understands.
func (s *Service) HandleStoreInfo(w http.ResponseWriter, r *http.Request) {
	httpkit.WriteJSON(w, http.StatusOK, s.files.StoreInfo())
}
