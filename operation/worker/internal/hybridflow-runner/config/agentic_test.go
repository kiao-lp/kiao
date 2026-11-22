package config

import (
	"os"
	"testing"

	coreconfig "kiao/worker/internal/core/config"
)

func TestAgenticManagerRequiresExplicitEndpoint(t *testing.T) {
	t.Setenv("KIAO_AGENTIC_RESOURCE_MANAGER_URL", "")
	os.Unsetenv("KIAO_AGENTIC_RESOURCE_MANAGER_URL")
	if cfg := LoadConfig(&coreconfig.Config{}); cfg.AgenticURL != "" {
		t.Fatalf("unconfigured manager endpoint: %q", cfg.AgenticURL)
	}
	t.Setenv("KIAO_AGENTIC_RESOURCE_MANAGER_URL", " https://boards.example.com/api/agentic/ ")
	t.Setenv("KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN", " resource-token ")
	cfg := LoadConfig(&coreconfig.Config{})
	if cfg.AgenticURL != "https://boards.example.com/api/agentic" || cfg.AgenticToken != "resource-token" {
		t.Fatalf("configured manager access: %q, %q", cfg.AgenticURL, cfg.AgenticToken)
	}
}
