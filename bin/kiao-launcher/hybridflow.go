package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
)

// Use the worker/service environment names so the launcher, SPA proxy and worker
// address the same boards. Remote instances share a board list with no per-store
// or per-machine labels. A database URL instead starts an instance-owned service;
// with neither configured, /boards reports that boards are unavailable.
const (
	remoteEnv   = "KIAO_WORKER_HYBRIDFLOW_URL"
	tokenEnv    = "KIAO_WORKER_HYBRIDFLOW_TOKEN"
	actorEnv    = "KIAO_HYBRIDFLOW_ACTOR"
	databaseEnv = "KIAO_HYBRIDFLOW_STORE_DATABASE_URL"
)

type boards struct {
	// Remote hybridflow-store base URL, without a trailing slash.
	remote string
	// Deployment service token: local instances have no Keycloak session.
	// It authorizes the separate actor header (auth.ActorHeader in the service).
	token string
	// Only service-token callers may name an actor; JWT callers retain their identity.
	actor string
	database string
}

func (b boards) remoteBoards() bool { return b.remote != "" }

func (b boards) ownBoards() bool { return b.remote == "" && b.database != "" }

func (b boards) configured() bool { return b.remote != "" || b.database != "" }

// Reject simultaneous remote and database URLs to avoid silently writing to the wrong service.
func boardsFromEnv() (boards, error) {
	b := boards{
		remote:   strings.TrimRight(strings.TrimSpace(os.Getenv(remoteEnv)), "/"),
		token:    strings.TrimSpace(os.Getenv(tokenEnv)),
		actor:    strings.TrimSpace(os.Getenv(actorEnv)),
		database: strings.TrimSpace(os.Getenv(databaseEnv)),
	}
	if b.remote != "" && b.database != "" {
		return boards{}, fmt.Errorf("%s and %s are both set: the first is a service to send the "+
			"boards to, the second a database to serve them from — unset one", remoteEnv, databaseEnv)
	}
	if b.remote != "" {
		parsed, err := url.Parse(b.remote)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return boards{}, fmt.Errorf("%s is %q, want a URL like https://boards.example.com/api/hybridflow",
				remoteEnv, b.remote)
		}
	}
	if b.actor == "" {
		b.actor = loginName()
	}
	return b, nil
}

// If the login is unknown, leave attribution to the service rather than guessing.
func loginName() string {
	if who, err := user.Current(); err == nil && who.Username != "" {
		return who.Username
	}
	return ""
}

// Show the destination and actor at startup: live and throwaway boards look identical in the UI.
func (b boards) describe() string {
	if b.remote != "" {
		if b.actor != "" {
			return fmt.Sprintf("%s (as %s)", b.remote, b.actor)
		}
		return b.remote
	}
	return describeDatabase(b.database)
}

// Keep the worker runner and SPA pointed at the same service. Both fields are
// empty without boards, in which case the service refuses to play.
type hybridflowAccess struct {
	url   string
	token string
}

// Mint an in-memory token shared by the children for this launch only; never persist it.
// Remote services instead require their deployment token.
func newServiceToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("cannot mint a service token: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// Debug auth matches the VITE_NO_SECURITY SPA; only the launcher proxy reaches the
// loopback port. The token still lets the runner name an owner. The service creates
// and migrates its schema at startup, including on an empty database.
func startHybridflowStore(bin, databaseURL, token string, port int) (*childProcess, error) {
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"KIAO_HYBRIDFLOW_STORE_PORT="+fmt.Sprint(port),
		databaseEnv+"="+databaseURL,
		"KIAO_HYBRIDFLOW_STORE_AUTH_MODE=debug",
		"KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN="+token,
		// Same-origin calls through the launcher proxy need no CORS list.
		"KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS=",
	)
	return startChild("hybridflow-store", cmd)
}

func hybridflowBinary(installDir string) (string, error) {
	bin := filepath.Join(installDir, "bin", "hybridflow-store")
	if _, err := os.Stat(bin); err != nil {
		return "", fmt.Errorf("%s is set but there is no hybridflow-store in %s; "+
			"reinstall with bin/install-kiao-executable.sh", databaseEnv, filepath.Join(installDir, "bin"))
	}
	return bin, nil
}

// Redact the password and query before logging the connection string.
func describeDatabase(dsn string) string {
	shown := dsn
	if at := strings.LastIndex(shown, "@"); at >= 0 {
		if scheme := strings.Index(shown, "://"); scheme >= 0 && scheme+3 < at {
			credentials := shown[scheme+3 : at]
			if colon := strings.Index(credentials, ":"); colon >= 0 {
				credentials = credentials[:colon] + ":***"
			}
			shown = shown[:scheme+3] + credentials + shown[at:]
		}
	}
	if query := strings.Index(shown, "?"); query >= 0 {
		shown = shown[:query]
	}
	return shown
}
