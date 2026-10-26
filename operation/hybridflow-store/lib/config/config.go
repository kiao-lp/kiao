// Package config loads deployment settings at startup; core must not depend on it.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Share worker's realm variable names so both services validate the same tokens.
const (
	EnvPort         = "KIAO_HYBRIDFLOW_STORE_PORT"
	EnvDatabaseURL  = "KIAO_HYBRIDFLOW_STORE_DATABASE_URL"
	EnvMaxConns     = "KIAO_HYBRIDFLOW_STORE_MAX_CONNS"
	EnvAuthMode     = "KIAO_HYBRIDFLOW_STORE_AUTH_MODE"
	EnvIssuerURI    = "KIAO_KEYCLOAK_ISSUER_URI"
	EnvJwkSetURI    = "KIAO_KEYCLOAK_JWK_SET_URI"
	EnvServiceToken = "KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN"
	EnvChangeTTL    = "KIAO_HYBRIDFLOW_STORE_CHANGE_RETENTION_HOURS"
	EnvCorsOrigins  = "KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS"
	EnvWatchTimeout = "KIAO_HYBRIDFLOW_STORE_WATCH_TIMEOUT_SECONDS"
)

type Config struct {
	Port string

	// DatabaseURL has no default: never guess a deployment's database.
	DatabaseURL string
	// Keep the pool small to avoid exhausting a shared database.
	MaxConns int

	// AuthMode is "prod" (validated OAuth2/JWT) or "debug" (permit all; decode tokens only).
	AuthMode  string
	IssuerURI string
	JwkSetURI string
	// ServiceToken authenticates services whose work outlives the user's request/token.
	// Empty disables this credential path; both services must set the same value.
	ServiceToken string

	// ChangeRetention bounds the cursor feed; older clients must reload the board.
	ChangeRetention time.Duration
	// WatchTimeout ends held connections before a proxy does.
	WatchTimeout time.Duration

	// CorsOrigins permits Dashboard origins; credentialed requests cannot use a wildcard.
	CorsOrigins []string
}

// Getenv trims the environment value and uses fallback when it is empty.
func Getenv(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func getenvInt(name string, fallback int) int {
	if value, err := strconv.Atoi(Getenv(name, "")); err == nil {
		return value
	}
	return fallback
}

// Load leaves validation to Validate so startup can report all problems at once.
func Load() *Config {
	return &Config{
		Port:            Getenv(EnvPort, "18081"),
		DatabaseURL:     Getenv(EnvDatabaseURL, ""),
		MaxConns:        getenvInt(EnvMaxConns, 8),
		AuthMode:        Getenv(EnvAuthMode, "prod"),
		IssuerURI:       Getenv(EnvIssuerURI, ""),
		JwkSetURI:       Getenv(EnvJwkSetURI, ""),
		ServiceToken:    Getenv(EnvServiceToken, ""),
		ChangeRetention: time.Duration(getenvInt(EnvChangeTTL, 72)) * time.Hour,
		WatchTimeout:    time.Duration(getenvInt(EnvWatchTimeout, 25)) * time.Second,
		CorsOrigins:     splitList(Getenv(EnvCorsOrigins, "")),
	}
}

func splitList(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// Validate returns all configuration problems; the program logs them and exits.
func Validate(cfg *Config) []string {
	var problems []string
	if cfg.DatabaseURL == "" {
		problems = append(problems, fmt.Sprintf("%s is not set: this service has nothing to serve without a database", EnvDatabaseURL))
	}
	if cfg.MaxConns < 1 {
		problems = append(problems, fmt.Sprintf("%s must be at least 1", EnvMaxConns))
	}
	switch cfg.AuthMode {
	case "prod":
		if cfg.IssuerURI == "" {
			problems = append(problems, fmt.Sprintf("%s is required in prod auth mode", EnvIssuerURI))
		}
		if cfg.JwkSetURI == "" {
			problems = append(problems, fmt.Sprintf("%s is required in prod auth mode", EnvJwkSetURI))
		}
	case "debug":
	default:
		problems = append(problems, fmt.Sprintf("%s is %q, want \"prod\" or \"debug\"", EnvAuthMode, cfg.AuthMode))
	}
	return problems
}
