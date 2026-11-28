package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"kiao/agentic-resource-manager/adapters/apm"
	"kiao/agentic-resource-manager/adapters/auth"
	"kiao/agentic-resource-manager/adapters/cache"
	"kiao/agentic-resource-manager/adapters/filesystem"
	"kiao/agentic-resource-manager/adapters/gitcli"
	"kiao/agentic-resource-manager/adapters/httpapi"
	"kiao/agentic-resource-manager/core/services"
	"kiao/gitidentity"
)

type clock struct{}

func (clock) Now() time.Time { return time.Now().UTC() }

type ids struct{}

func (ids) NewID() string {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		panic(err)
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
}
func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func main() {
	mode := env("KIAO_AGENTIC_RESOURCE_MANAGER_AUTH_MODE", "prod")
	issuer, jwks := os.Getenv("KIAO_KEYCLOAK_ISSUER_URI"), os.Getenv("KIAO_KEYCLOAK_JWK_SET_URI")
	if mode != "debug" && (mode != "prod" || issuer == "" || jwks == "") {
		slog.Error("prod authentication requires issuer and JWKS URIs")
		os.Exit(1)
	}
	statePath := os.Getenv("KIAO_WORKER_STATE_PATH")
	dcmsRoot := os.Getenv("KIAO_WORKER_DCMS_ROOT")
	if dcmsRoot == "" {
		dcmsRoot = os.Getenv("KIAO_WORKER_ROOT_PATH")
	}
	if statePath == "" && dcmsRoot != "" {
		statePath = filepath.Join(dcmsRoot, ".kiao-config")
	}
	if statePath != "" {
		if err := gitidentity.Install(statePath); err != nil {
			slog.Error("cannot configure Git subprocesses", "error", err)
			os.Exit(1)
		}
	}
	agentRoot, err := filepath.Abs(env("KIAO_AGENTIC_RESOURCES_PATH", "agentic-resources"))
	if err != nil {
		slog.Error("agent directory", "error", err)
		os.Exit(1)
	}
	dependencyRoot := env("KIAO_AGENTIC_DEPENDENCIES_PATH", "")
	if dependencyRoot != "" {
		dependencyRoot, err = filepath.Abs(dependencyRoot)
		if err != nil {
			slog.Error("dependency directory", "error", err)
			os.Exit(1)
		}
	}
	cacheRoot := env("KIAO_AGENTIC_RESOURCE_MANAGER_CACHE", filepath.Join(agentRoot, ".cache"))
	compiler := apm.Compiler{
		Binary:   env("KIAO_APM_BINARY", "apm"),
		GitSeeds: filepath.SplitList(os.Getenv("KIAO_APM_GIT_SEEDS")),
	}
	repository := filesystem.New(agentRoot, gitcli.Controller{}, compiler, cache.Directory{Root: cacheRoot})
	repository.DependencyRoot = dependencyRoot
	api := httpapi.API{Agents: services.NewAgents(repository, clock{}, ids{}), Resources: services.NewAgenticResources(repository)}
	authenticator := auth.New(auth.Options{Mode: mode, IssuerURI: issuer, JwkSetURI: jwks, ServiceToken: os.Getenv("KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN")})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.Handle("/", httpapi.CORS(strings.Split(os.Getenv("KIAO_AGENTIC_RESOURCE_MANAGER_CORS_ORIGINS"), ","), authenticator.Middleware(api.Handler())))
	server := &http.Server{Addr: env("KIAO_AGENTIC_RESOURCE_MANAGER_BIND", "") + ":" + env("KIAO_AGENTIC_RESOURCE_MANAGER_PORT", "18082"), Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		slog.Info("agentic-resource-manager listening", "address", server.Addr, "agents", agentRoot, "dependencies", dependencyRoot)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listener failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
