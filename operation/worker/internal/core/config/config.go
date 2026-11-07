package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds deployment settings shared by both service halves.
// Each half embeds it in its own Config.
type Config struct {
	Port     string // SERVER_PORT, default 8080
	RootPath string // KIAO_WORKER_ROOT_PATH, default /tmp

	// State follows the store by default. Storage hides it from the file API;
	// a .gitignore excludes it from Source Control to protect transcripts.
	StatePath string // KIAO_WORKER_STATE_PATH, default <RootPath>/.kiao-config

	IssuerURI string // KIAO_KEYCLOAK_ISSUER_URI
	JwkSetURI string // KIAO_KEYCLOAK_JWK_SET_URI

	// ReaderRoots restricts files_reader callers without files_user to these
	// root-relative prefixes. An empty list denies all reader access; files_user
	// is never scoped by it.
	ReaderRoots []string // KIAO_WORKER_READER_ROOTS, default "units"

	// Used by both file-store migrations and turn MCP servers.
	NodeBinary string // KIAO_WORKER_MIGRATIONS_NODE_BINARY, default "node"

	// AuthMode is "prod" (strict OAuth2/JWT) or "debug" (permit all, decode-without-validate).
	AuthMode string

	MaxUploadBytes int64
}

// Validate returns configuration problems; main logs them and exits at startup.
func (c *Config) Validate() []string {
	var problems []string
	rootInfo, rootErr := os.Stat(c.RootPath)

	switch {
	case strings.TrimSpace(c.RootPath) == "":
		problems = append(problems, "KIAO_WORKER_ROOT_PATH is empty")
	case rootErr != nil || !rootInfo.IsDir():
		problems = append(problems, fmt.Sprintf("KIAO_WORKER_ROOT_PATH %q is not an existing directory", c.RootPath))
	}

	// Reject relative state paths: a service working directory may be unintended.
	// defaultStatePath already makes the default absolute.
	switch {
	case strings.TrimSpace(c.StatePath) == "":
		problems = append(problems, "KIAO_WORKER_STATE_PATH is empty")
	case !filepath.IsAbs(c.StatePath):
		problems = append(problems, fmt.Sprintf(
			"KIAO_WORKER_STATE_PATH %q is not absolute; set it explicitly, as there is no "+
				"home directory to default it to", c.StatePath))
	}

	switch c.AuthMode {
	case "prod":
		if strings.TrimSpace(c.IssuerURI) == "" {
			problems = append(problems, "KIAO_KEYCLOAK_ISSUER_URI is required in prod auth mode")
		}
		if strings.TrimSpace(c.JwkSetURI) == "" {
			problems = append(problems, "KIAO_KEYCLOAK_JWK_SET_URI is required in prod auth mode")
		}
	case "debug":
	default:
		problems = append(problems, fmt.Sprintf("KIAO_WORKER_AUTH_MODE %q is not one of: prod, debug", c.AuthMode))
	}

	return problems
}

// LoadConfig reads environment settings with deployment defaults.
func LoadConfig() *Config {
	root := Getenv("KIAO_WORKER_ROOT_PATH", "/tmp")

	authMode := Getenv("KIAO_WORKER_AUTH_MODE", "")
	if authMode == "" {
		// Fall back to the Spring profile only when AuthMode is unset or empty.
		if strings.Contains(strings.ToLower(Getenv("SPRING_PROFILES_ACTIVE", "")), "debug") {
			authMode = "debug"
		} else {
			authMode = "prod"
		}
	}

	// Explicitly empty disables reader access; only unset uses the default.
	readerRootsCSV := "units"
	if v, ok := os.LookupEnv("KIAO_WORKER_READER_ROOTS"); ok {
		readerRootsCSV = v
	}
	var readerRoots []string
	for _, p := range strings.Split(readerRootsCSV, ",") {
		if p = strings.TrimSpace(p); p != "" {
			readerRoots = append(readerRoots, p)
		}
	}

	return &Config{
		Port:           Getenv("SERVER_PORT", "8080"),
		RootPath:       root,
		StatePath:      Getenv("KIAO_WORKER_STATE_PATH", DefaultStatePath(root)),
		IssuerURI:      Getenv("KIAO_KEYCLOAK_ISSUER_URI", ""),
		JwkSetURI:      Getenv("KIAO_KEYCLOAK_JWK_SET_URI", ""),
		ReaderRoots:    readerRoots,
		NodeBinary:     Getenv("KIAO_WORKER_MIGRATIONS_NODE_BINARY", "node"),
		AuthMode:       authMode,
		MaxUploadBytes: 100 << 20, // 100 MiB
	}
}

// defaultStatePath keeps state with its store and makes the path absolute
// to satisfy Validate, even when the root is relative.
func DefaultStatePath(root string) string {
	abs, err := filepath.Abs(root)
	if err != nil {
		// Unreadable working directory: Validate rejects the relative fallback.
		return filepath.Join(root, StateDirName)
	}
	return filepath.Join(abs, StateDirName)
}

// Getenv treats empty values as unset.
func Getenv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// GetenvInt falls back on malformed input; semantic validation is the caller's job.
func GetenvInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return n
}

// GetenvPath preserves explicitly empty values, which disable path-based features.
func GetenvPath(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return strings.TrimSpace(v)
	}
	return def
}

func GetenvBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	default:
		return def
	}
}
