package toolboxhttp

import (
	"kiao/worker/internal/toolbox/install"
)

type Handler struct{ *install.Service }

func NewHandler(service *install.Service) *Handler { return &Handler{Service: service} }
