package mcp

import (
	"kiao/worker/internal/core/equipment"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"kiao/worker/internal/toolbox/inventory"
)

type Registry struct {
	cfg     *toolconfig.Config
	catalog *toolcatalog.Catalog
	ledger  *inventory.Ledger
	bundled map[string]equipment.MCPServer
}

func NewRegistry(cfg *toolconfig.Config, catalog *toolcatalog.Catalog, ledger *inventory.Ledger, bundled map[string]equipment.MCPServer) *Registry {
	return &Registry{cfg: cfg, catalog: catalog, ledger: ledger, bundled: bundled}
}
