package httpapi

import (
	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/lib/httpx"
	"net/http"
)

func (a *API) recordExecution(w http.ResponseWriter, r *http.Request) {
	execution, err := decode[entities.TaskExecution](r)
	if err == nil {
		execution.FlowNodeID = r.PathValue("id")
		err = a.executions.Record(r.Context(), execution)
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) listExecutions(w http.ResponseWriter, r *http.Request) {
	executions, err := a.executions.List(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, executions)
}
