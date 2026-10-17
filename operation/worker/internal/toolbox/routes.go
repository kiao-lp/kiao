package toolbox

import "kiao/worker/internal/core"

// Routes is this library's HTTP surface: what the machine could be outfitted with, what it has, and
// the two verbs that change that. The program mounts them — nothing is served that it did not
// mount — and mounts the other libraries' the same way.
//
// None of these joins readerRoutes in the program. A caller bearing the read-only role is a podcast
// listener; the software installed on the machine serving them is not a question they get to ask.
func (s *Service) Routes() []core.Route {
	return []core.Route{
		{Pattern: "GET /toolbox", Handler: s.HandleGetToolbox},
		{Pattern: "POST /toolbox/install", Handler: s.HandleInstall},
		{Pattern: "POST /toolbox/uninstall", Handler: s.HandleUninstall},
		{Pattern: "POST /toolbox/registration", Handler: s.HandleSetRegistration},
		{Pattern: "GET /toolbox/jobs/{id}", Handler: s.HandleGetJob},
	}
}
