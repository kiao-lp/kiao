package toolboxhttp

import (
	"kiao/worker/internal/core/http"
)

// Routes is this library's HTTP surface: what the machine could be outfitted with, what it has, and
// the two verbs that change that. The program mounts them — nothing is served that it did not
// mount — and mounts the other libraries' the same way.
func (s *Handler) Routes() []httpkit.Route {
	return []httpkit.Route{
		{Pattern: "GET /toolbox", Handler: s.HandleGetToolbox},
		{Pattern: "POST /toolbox/install", Handler: s.HandleInstall},
		{Pattern: "POST /toolbox/uninstall", Handler: s.HandleUninstall},
		{Pattern: "POST /toolbox/registration", Handler: s.HandleSetRegistration},
		{Pattern: "GET /toolbox/jobs/{id}", Handler: s.HandleGetJob},
	}
}
