// hybridflow-store keeps the boards and the cards filed on them, in PostgreSQL.
//
// It is the **composition root** and nothing else: it reads the environment, opens the database,
// brings the schema up to date, wires the adapters to the core's services, and serves. Every rule
// about what a board is lives in core/; every statement of SQL lives in adapters/postgres; this
// file is the only one that knows both exist.
//
//	operation/hybridflow-store/
//	├── core/
//	│   ├── entities/   the domain — boards, cards, agents, runners
//	│   ├── ports/      what the core asks of the outside world
//	│   └── services/   the rules, written against the ports
//	├── adapters/
//	│   ├── postgres/   the ports over PostgreSQL, and the schema migrations
//	│   ├── httpapi/    the services published as a JSON API
//	│   └── auth/       Keycloak JWTs, the ones worker accepts
//	└── lib/            what two or more of them share: logging, httpx, config
//
// See README.md for the API, and
// /operation/hybridflow-store/docs/solution-design/schema.md for the schema and the
// reasoning behind it.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/adapters/auth"
	"kiao/hybridflow-store/adapters/httpapi"
	"kiao/hybridflow-store/adapters/postgres"
	"kiao/hybridflow-store/core/services"
	"kiao/hybridflow-store/lib/config"
	"kiao/hybridflow-store/lib/logging"
)

func main() {
	cfg := config.Load()
	if problems := config.Validate(cfg); len(problems) > 0 {
		for _, problem := range problems {
			logging.Main.Error("configuration problem", "problem", problem)
		}
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// The database, and the schema pass with it. A failure here is fatal on purpose: a service that
	// cannot reach its store has nothing to serve, and one serving against a schema it was not built
	// for is worse than one that is down.
	pool, applied, err := postgres.Open(ctx, postgres.Options{
		DatabaseURL:     cfg.DatabaseURL,
		MaxConns:        cfg.MaxConns,
		ChangeRetention: cfg.ChangeRetention,
	})
	if err != nil {
		logging.Main.Error("the database could not be opened", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	boardStore := postgres.NewBoardStore(pool)
	agentStore := postgres.NewAgentStore(pool)
	runnerStore := postgres.NewRunnerStore(pool)
	usageStore := postgres.NewUsageStore(pool)
	changeStore := postgres.NewChangeStore(pool)
	ids := postgres.NewIDs(pool)
	clock := postgres.SystemClock{}

	// The change listener, for the life of the process. It reconnects on its own; while it is down
	// the watch endpoint polls instead of waiting, so a database restart costs latency and not
	// updates.
	go changeStore.Listen(ctx)

	// Pruning the change log, now and then daily. The feed is a cursor and not an archive.
	go prune(ctx, pool, cfg.ChangeRetention)

	api := httpapi.New(httpapi.Options{
		Boards:          services.NewBoards(boardStore, clock, ids),
		FlowNodes:       services.NewFlowNodes(boardStore, agentStore, runnerStore, boardStore, boardStore, clock, ids),
		FlowNodeClasses: services.NewFlowNodeClasses(boardStore, boardStore, agentStore, runnerStore, boardStore, clock, ids),
		Workflows:       services.NewWorkflows(boardStore, boardStore, boardStore, clock, ids),
		Agents:          services.NewAgents(agentStore, clock, ids),
		Runners:         services.NewRunners(runnerStore, clock, ids),
		Usage:           services.NewUsage(usageStore, boardStore, clock, ids),
		Changes:         changeStore,
		Schema:          schemaDto(applied),
		WatchTimeout:    cfg.WatchTimeout,
	})
	authenticator := auth.New(auth.Options{
		Mode: cfg.AuthMode, IssuerURI: cfg.IssuerURI, JwkSetURI: cfg.JwkSetURI,
		ServiceToken: cfg.ServiceToken,
	})

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: api.Handler(authenticator, cfg.CorsOrigins),
		// No write timeout: `GET /changes?wait=1` holds a request on purpose, and a write deadline
		// would cut it at a moment nobody chose. The wait is bounded by WatchTimeout instead, which
		// is a bound this service picked rather than one the transport imposed.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		logging.Main.Info("listening", "port", cfg.Port, "auth_mode", cfg.AuthMode,
			"cors_origins", cfg.CorsOrigins)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.Main.Error("the listener stopped", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	logging.Main.Info("stopping")
	// Long enough for a held watch to end and for a write in flight to commit, short enough that a
	// deploy is not waiting on it.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logging.Main.Warn("the listener did not stop cleanly", "error", err)
	}
}

// prune drops the old rows of the change log, at startup and then once a day.
func prune(ctx context.Context, pool *pgxpool.Pool, retention time.Duration) {
	for {
		if dropped, err := postgres.PruneChanges(ctx, pool, retention); err != nil {
			logging.Main.Warn("the change log could not be pruned", "error", err)
		} else if dropped > 0 {
			logging.Main.Info("pruned the change log", "rows", dropped)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}

func schemaDto(applied []postgres.AppliedMigration) httpapi.SchemaDto {
	out := httpapi.SchemaDto{Migrations: make([]httpapi.MigrationDto, 0, len(applied))}
	for _, line := range applied {
		out.Migrations = append(out.Migrations, httpapi.MigrationDto{
			Version: line.Version, Name: line.Name, Checksum: line.Checksum,
			AppliedAt: line.AppliedAt, DurationMs: line.DurationMs,
		})
		if line.Version > out.Version {
			out.Version = line.Version
		}
	}
	return out
}
