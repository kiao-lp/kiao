package config

const PermissionModeManual = "manual"

const PermissionModeManualLive = "manualLive"

const PermissionModeBypass = "bypassPermissions"

func AsksBeforeTools(mode string) bool {
	return mode == PermissionModeManual || mode == PermissionModeManualLive
}

// allowsPermissionMode gates the known bypass mode by deployment policy.
func (c *Config) AllowsPermissionMode(mode string) bool {
	return mode != PermissionModeBypass || c.BypassEnabled
}

// Preserve the legacy bypass default when allowed; otherwise default to manual.
func (c *Config) DefaultPermissionMode() string {
	if c.BypassEnabled {
		return PermissionModeBypass
	}
	return PermissionModeManual
}
