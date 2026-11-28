package httpapi

import (
	"net/http"

	"kiao/hybridflow-store/core/services"
	"kiao/hybridflow-store/lib/httpx"
)

type FolderDto struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type folderNameDto struct {
	Name string `json:"name"`
}

func registerFolderRoutes(mux *http.ServeMux, path string, folders *services.Folders) {
	mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
		list, err := folders.List(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out := make([]FolderDto, 0, len(list))
		for _, folder := range list {
			out = append(out, FolderDto(folder))
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"folders": out})
	})
	mux.HandleFunc("POST "+path, func(w http.ResponseWriter, r *http.Request) {
		req, err := decode[folderNameDto](r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		folder, err := folders.Create(r.Context(), req.Name)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, FolderDto(*folder))
	})
	mux.HandleFunc("PATCH "+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		req, err := decode[folderNameDto](r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		folder, err := folders.Rename(r.Context(), r.PathValue("id"), req.Name)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, FolderDto(*folder))
	})
	mux.HandleFunc("DELETE "+path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := folders.Delete(r.Context(), r.PathValue("id"), actorOf(r)); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
