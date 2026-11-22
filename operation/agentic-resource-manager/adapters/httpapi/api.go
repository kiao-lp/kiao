package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"kiao/agentic-resource-manager/core/entities"
	"kiao/agentic-resource-manager/core/services"
)

type API struct {
	Agents    *services.Agents
	Resources *services.AgenticResources
}

func (a API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /agents", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Agents.List(r.Context())
		respond(w, r, http.StatusOK, map[string]any{"agents": result}, err)
	})
	mux.HandleFunc("POST /agents", func(w http.ResponseWriter, r *http.Request) {
		request, err := decode[services.NewAgentRequest](r)
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		result, err := a.Agents.Create(r.Context(), request, "")
		respond(w, r, http.StatusCreated, result, err)
	})
	mux.HandleFunc("GET /agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Agents.Find(r.Context(), r.PathValue("id"))
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("PATCH /agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		request, err := decode[entities.AgentPatch](r)
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		revision, err := revisionOf(r)
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		result, err := a.Agents.Patch(r.Context(), r.PathValue("id"), request, revision, "")
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("POST /agents/{id}/publish", func(w http.ResponseWriter, r *http.Request) {
		revision, err := revisionOf(r)
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		request, err := decode[struct {
			Confirmation string               `json:"confirmation"`
			Bump         entities.ReleaseBump `json:"bump"`
		}](r, true)
		if err != nil {
			respond(w, r, 0, nil, err)
			return
		}
		result, err := a.Agents.Publish(r.Context(), r.PathValue("id"), revision, "", request.Confirmation, request.Bump)
		respond(w, r, http.StatusCreated, result, err)
	})
	mux.HandleFunc("GET /agents/{id}/versions", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Agents.Versions(r.Context(), r.PathValue("id"))
		respond(w, r, http.StatusOK, map[string]any{"versions": result}, err)
	})
	mux.HandleFunc("GET /agents/{id}/deletion", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Agents.DeletionStatus(r.Context(), r.PathValue("id"))
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("DELETE /agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		err := a.Agents.Delete(r.Context(), r.PathValue("id"), r.URL.Query().Get("confirmation"), "")
		respond(w, r, http.StatusNoContent, nil, err)
	})
	mux.HandleFunc("GET /agents/{id}/packages/{commit}", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Resources.Package(r.Context(), r.PathValue("id"), r.PathValue("commit"))
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("POST /agents/{id}/packages/draft", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Resources.DraftPackage(r.Context(), r.PathValue("id"))
		respond(w, r, http.StatusOK, result, err)
	})
	for path, kind := range map[string]entities.AgentDependencyKind{
		"/agents/{id}/skills": entities.AgentSkill,
		"/agents/{id}/mcp":    entities.AgentMCP,
	} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			result, err := a.Resources.Dependencies(r.Context(), r.PathValue("id"), kind)
			respond(w, r, http.StatusOK, result, err)
		})
		setLink := func(w http.ResponseWriter, r *http.Request) {
			linked := r.Method == http.MethodPut
			var local bool
			if linked {
				request, err := decode[struct {
					Local bool `json:"local"`
				}](r, true)
				if err != nil {
					respond(w, r, 0, nil, err)
					return
				}
				local = request.Local
			}
			err := a.Resources.SetDependency(r.Context(), r.PathValue("id"), kind, r.PathValue("name"), linked, local)
			respond(w, r, http.StatusNoContent, nil, err)
		}
		mux.HandleFunc("PUT "+path+"/{name}", setLink)
		mux.HandleFunc("DELETE "+path+"/{name}", setLink)
	}
	mux.HandleFunc("GET /agentic-resources", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Resources.List(r.Context())
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("GET /agentic-resources/{name}/file", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Resources.Read(r.Context(), r.PathValue("name"), r.URL.Query().Get("path"))
		respond(w, r, http.StatusOK, result, err)
	})
	mux.HandleFunc("PUT /agentic-resources/{name}/file", func(w http.ResponseWriter, r *http.Request) {
		file, err := decode[entities.ResourceFile](r)
		if err == nil {
			err = a.Resources.Write(r.Context(), r.PathValue("name"), file)
		}
		respond(w, r, http.StatusOK, file.Versioned(), err)
	})
	mux.HandleFunc("POST /agentic-resources/{name}/{operation}", func(w http.ResponseWriter, r *http.Request) {
		request, err := decode[struct {
			Message      string               `json:"message"`
			Confirmation string               `json:"confirmation"`
			Bump         entities.ReleaseBump `json:"bump"`
		}](r)
		if err == nil {
			err = a.Resources.Operate(r.Context(), r.PathValue("name"), r.PathValue("operation"), request.Message, request.Confirmation, request.Bump)
		}
		respond(w, r, http.StatusNoContent, nil, err)
	})
	return mux
}

func decode[T any](r *http.Request, optional ...bool) (T, error) {
	var result T
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		if err == io.EOF && len(optional) > 0 && optional[0] {
			return result, nil
		}
		return result, entities.Invalidf("request body: %s", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return result, entities.Invalidf("request must contain one JSON value")
	}
	return result, nil
}

func revisionOf(r *http.Request) (*int64, error) {
	raw := strings.Trim(r.Header.Get("If-Match"), `"`)
	if raw == "" {
		return nil, nil
	}
	revision, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil, entities.Invalidf("invalid If-Match revision")
	}
	return &revision, nil
}

func respond(w http.ResponseWriter, r *http.Request, status int, value any, err error) {
	if err != nil {
		switch {
		case errors.Is(err, entities.ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(err, entities.ErrInvalid):
			status = http.StatusBadRequest
		case errors.Is(err, entities.ErrConflict), errors.Is(err, entities.ErrAgentNameTaken):
			status = http.StatusConflict
		default:
			status = http.StatusInternalServerError
		}
		message := err.Error()
		if status >= 500 {
			slog.Error("resource request failed", "path", r.URL.Path, "error", err)
			message = "resource operation failed; see service logs"
		}
		answer := map[string]any{"error": message}
		var confirmation *entities.PushConfirmation
		if errors.As(err, &confirmation) {
			answer["pushConfirmation"] = confirmation
		}
		value = answer
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		if err := json.NewEncoder(w).Encode(value); err != nil {
			slog.Warn("response failed", "error", err)
		}
	}
}

func CORS(origins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, origin := range origins {
			if origin != "" && r.Header.Get("Origin") == origin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			if recovered := recover(); recovered != nil {
				respond(w, r, 0, nil, fmt.Errorf("panic: %v", recovered))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
