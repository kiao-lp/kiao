package files

import (
	fileconfig "kiao/worker/internal/files/configuration"
	"kiao/worker/internal/files/http"
)

type Config = fileconfig.Config
type Service = fileshttp.Service

func Start(cfg *Config) (*Service, error) { return fileshttp.Start(cfg) }
