package main

import (
	"context"
	"errors"
	"kiao/worker/internal/core"
	"kiao/worker/internal/files"
	"kiao/worker/internal/hybridflow-runner"
	"kiao/worker/internal/toolbox"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	if hybridflowrunner.RunAgentProcessSupervisor() {
		return
	}
	// `worker toolbox preinstall …` installs
	// catalogue components into a prefix named on its command line — which is how a build script
	// stages the agent CLIs into an image without holding a pin, a digest and a cache of its own
	// (see internal/toolbox/cli.go). It runs before any configuration is read, because it has no
	// deployment behind it: no store, no port, no state directory.
	if len(os.Args) > 1 && os.Args[1] == "toolbox" {
		os.Exit(toolbox.RunCLI(os.Args[2:]))
	}

	// Before anything can log: a deployment naming KIAO_WORKER_LOG_FILE gets every line
	// in that file as well as on stdout — including the configuration failures below, which is
	// what makes it worth attaching before the configuration is even read.
	core.InitLogFile()

	// One configuration read, three shares of it: the socle's, which every library embeds, and one
	// per library. The environment a deployment sets is unchanged — only who reads which variable is.
	shared := core.LoadConfig()
	fileCfg := files.LoadConfig(shared)
	hybridflowRunnerCfg := hybridflowrunner.LoadConfig(shared)
	toolCfg := toolbox.LoadConfig(shared)

	// Fail fast on a misconfigured environment, listing every problem at once rather than
	// crashing later with a cascade of runtime errors.
	// Which runner this service is: the environment wins where it names one, and the root's
	// own state directory otherwise — so the id travels with the root, and two roots on one
	// machine name two runners with no per-process bookkeeping (see runner_config.go).
	if hybridflowRunnerCfg.RunnerID == "" {
		id, err := hybridflowrunner.RunnerIDFromState(fileCfg.StatePath)
		if err != nil {
			core.LogMain.Error("runner configuration failure; aborting startup", "error", err)
			os.Exit(1)
		}
		hybridflowRunnerCfg.RunnerID = id
	}
	problems := append(fileCfg.Validate(), hybridflowRunnerCfg.Validate()...)
	if problems = append(problems, toolCfg.Validate()...); len(problems) > 0 {
		for _, p := range problems {
			core.LogMain.Error("invalid configuration", "problem", p)
		}
		os.Exit(1)
	}
	core.LogMain.Info("kiao-worker starting")
	logResolvedConfig(fileCfg, hybridflowRunnerCfg, toolCfg)

	// The state directory has to exist before anything under it is read or written, and it has to
	// be this process's alone: its registries are updated by renaming a whole document over the old
	// one, so two instances sharing a directory would not corrupt a file, they would silently
	// discard each other's writes. The lock is taken before the migrations so a second instance
	// fails immediately rather than after doing work.
	if err := core.EnsureStateDir(shared); err != nil {
		core.LogMain.Error("state directory failure; aborting startup", "error", err)
		os.Exit(1)
	}
	// flock is released by the kernel when the process dies, so a refusal here always means a live
	// second instance and never a lock left behind by a crash.
	releaseState, locked, err := core.AcquireLock(filepath.Join(shared.StatePath, core.StateLockFile))
	if err != nil {
		core.LogMain.Error("cannot lock the state directory; aborting startup",
			"state_path", shared.StatePath, "error", err)
		os.Exit(1)
	}
	if !locked {
		core.LogMain.Error("another kiao-worker instance is already using this state directory; "+
			"stop it, or give this one its own KIAO_WORKER_STATE_PATH",
			"state_path", shared.StatePath)
		os.Exit(1)
	}
	defer releaseState()

	// The store's own declaration of what in it is not KIAO content — seeded with defaults on a
	// store that has none, and absorbing a legacy migration-ignore on a store written by the
	// previous layout. Before the migration runner, which is one of the passes it bounds.
	files.EnsureStoreDeclaration(fileCfg)
	// Logged on every start, not only when a migration is pending: the link fixer is bounded by the
	// same declaration and runs on every rename and every delete, and so are search and the scope a
	// delete reports. What the passes will not touch, and where a search will not look, is the one
	// thing an operator has no other way of checking.
	files.LogStoreDeclaration(fileCfg)
	// The catalogue the review of an upload highlights against — credentials, classification
	// markings, personal data. Seeded on a store that has never been configured, because a gate
	// nobody has written JSON for is a gate that never fires.
	files.EnsureImportGateMatchers(fileCfg)
	// Delivered PDF themes follow the build; store-specific themes keep their own filenames.
	files.SyncPdfThemes(fileCfg)

	// A store written by the previous layout still keeps the ledger, the registries and the Dashboard
	// documents in the data root. They are collected here, under the lock and before the migration
	// runner reads a ledger that is itself one of them (see state_legacy.go).
	if moved := adoptLegacyState(shared); moved > 0 {
		core.LogMain.Info("adopted state from the previous layout",
			"entries", moved, "state_path", shared.StatePath)
	}

	// A store that last ran before the Dashboard rename still carries its configuration
	// documents under their old names. They are renamed here, under the same lock and before
	// the migration runner and every reader (see state_legacy.go).
	if renamed := adoptRenamedStateDocs(shared.StatePath); renamed > 0 {
		core.LogMain.Info("renamed state files to their current names",
			"entries", renamed, "state_path", shared.StatePath)
	}

	// Apply pending file-store migrations before accepting traffic, so the service never serves
	// on a half-migrated store (FileMigrationRunner, fail-fast by default).
	if err := files.RunMigrations(fileCfg); err != nil {
		core.LogMain.Error("migration failure; aborting startup", "error", err)
		os.Exit(1)
	}

	// The document store: browsing, searching, Git, link repair, actions, configuration documents.
	fileSvc, err := files.Start(fileCfg)
	if err != nil {
		core.LogMain.Error("file service failure; aborting startup", "error", err)
		os.Exit(1)
	}

	// The outfitting of the machine: what is installed on it so that a turn can use it, and which
	// MCP servers a turn is handed. It is built before the hybridflow runner because it is what
	// answers that question — and it is given what the staged kiao-mcp bundle offers, because that
	// bundle's path is the *other* library's configuration. The two never import each other; this
	// is the one place that knows both, which is what it is for.
	bundled, err := hybridflowrunner.BundledMCPServers(hybridflowRunnerCfg)
	if err != nil {
		core.LogMain.Error("MCP bundle failure; aborting startup", "error", err)
		os.Exit(1)
	}
	toolSvc, err := toolbox.Start(toolCfg, bundled, hybridflowrunner.ConfiguredMCPServers(hybridflowRunnerCfg))
	if err != nil {
		core.LogMain.Error("toolbox failure; aborting startup", "error", err)
		os.Exit(1)
	}

	// The hybridflow runner, assembled whole: the conversations and their transcripts, the hub
	// that spawns a turn, the attachments, the account probe, the bundled skills, the MCP servers a
	// turn is handed, and the runner that plays a board. The boards live in the hybridflow-store
	// and are reached over HTTP, so this half takes no port into the file service.
	hybridflowRunnerSvc, err := hybridflowrunner.Start(hybridflowRunnerCfg, toolSvc)
	if err != nil {
		core.LogMain.Error("hybridflow-runner failure; aborting startup", "error", err)
		os.Exit(1)
	}
	// Where ffmpeg is, for the save that cuts a video's segments into files of their own. The
	// toolbox knows, and is asked at every save, so that installing ffmpeg from the configuration
	// panel works on the next click.
	fileSvc.UseFFmpeg(func() (string, bool) { return toolSvc.RuntimeBinary("ffmpeg") })

	// The one edge that runs the other way, and it exists because an agent CLI can now arrive while
	// the service is up: installing `claude` or `codex` from the configuration panel has to be
	// followed by the pass that fills that agent's skills directory, which otherwise only ever runs
	// at startup. Set here because this is the only place that holds both halves.
	toolSvc.OnAgentInstalled(hybridflowRunnerSvc.SyncEquipment)

	// And the same edge from the other half, for the same reason: which skills a store gets is its
	// plugin list, so saving that list from the configuration panel has to be followed by the pass
	// that fills the store's skills directories. Without this, switching a plugin off leaves its
	// skill in the store until someone restarts the service.
	fileSvc.OnDashboardConfigSaved(hybridflowRunnerSvc.SyncEquipment)

	// And the third edge, for the identity rather than the outfitting: saving `runner.json` from
	// the runners panel has to be followed by the re-read that adopts it — the heartbeat's next
	// beat and the next Play — rather than at the next restart. Without this, pressing "it's me"
	// would be a file that changes nothing until someone restarts the service.
	fileSvc.OnRunnerConfigSaved(hybridflowRunnerSvc.SyncRunnerIdentity)

	// The one place a credential other than a Keycloak JWT is accepted: the turns this very process
	// spawns, calling back in through their MCP servers. The registry is nil unless there is an MCP
	// configuration to spawn them with, so a deployment without one has no second path at all.
	authenticator := core.NewAuthenticator(shared, readerRoutes)
	if tokens := hybridflowRunnerSvc.TurnTokens(); tokens != nil {
		authenticator.AcceptTurnTokens(tokens)
	}

	srv := &Server{auth: authenticator, files: fileSvc, hybridflowRunner: hybridflowRunnerSvc, toolbox: toolSvc}

	httpServer := &http.Server{
		Addr:    ":" + shared.Port,
		Handler: srv.handler(),
		// Bound slow-header attacks and idle keep-alives. Deliberately no ReadTimeout or
		// WriteTimeout: those would abort large file up/downloads and the long-lived
		// /ws/hybridflow-runner WebSocket, which are legitimate here.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Graceful shutdown: on SIGINT/SIGTERM (systemd stop), stop accepting connections, kill any
	// running claude jobs, and drain in-flight requests within the grace period.
	shutdownDone := make(chan struct{})
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		s := <-sig
		core.LogMain.Info("shutting down", "signal", s.String())
		srv.hybridflowRunner.Shutdown()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			core.LogMain.Error("graceful shutdown error", "error", err)
		}
		close(shutdownDone)
	}()

	core.LogMain.Info("listening", "addr", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		core.LogMain.Error("server error", "error", err)
		os.Exit(1)
	}
	<-shutdownDone
	core.LogMain.Info("stopped")
}

// logResolvedConfig emits the effective configuration at startup, in one line, whichever half owns
// a setting. No Config holds a secret (issuer/JWKS are public URLs, the Claude credentials entry is
// a file path, not the token), so every field is logged verbatim to make a deployment's actual
// settings auditable.
func logResolvedConfig(cfg *files.Config, hybridflowRunnerCfg *hybridflowrunner.Config, toolCfg *toolbox.Config) {
	core.LogMain.Info("configuration",
		"port", cfg.Port,
		"root_path", cfg.RootPath,
		"state_path", cfg.StatePath,
		"auth_mode", cfg.AuthMode,
		"issuer_uri", cfg.IssuerURI,
		"jwk_set_uri", cfg.JwkSetURI,
		"git_user_name", cfg.GitUserName,
		"git_user_email", cfg.GitUserEmail,
		"link_fix_extensions", strings.Join(cfg.LinkFixExtensions, ","),
		"link_fix_workers", cfg.LinkFixWorkers,
		"migrations_path", cfg.MigrationsPath,
		"migrations_enabled", cfg.MigrationsEnabled,
		"migrations_fail_on_error", cfg.MigrationsFailOnErr,
		"node_binary", cfg.NodeBinary,
		"migrations_timeout", cfg.MigrationsTimeout,
		"hybridflow_runner_id", hybridflowRunnerCfg.RunnerID,
		"claude_credentials_path", hybridflowRunnerCfg.ClaudeCredentialsPath,
		"claude_login_enabled", hybridflowRunnerCfg.ClaudeLoginEnabled,
		"muse_login_enabled", hybridflowRunnerCfg.MuseLoginEnabled,
		"claude_max_turns", hybridflowRunnerCfg.MaxTurns,
		"claude_setting_sources", hybridflowRunnerCfg.ClaudeSettingSources,
		"actions_path", cfg.ActionsPath,
		"shutdown_command", hybridflowRunnerCfg.ShutdownCommand,
		"mcp_path", hybridflowRunnerCfg.MCPPath,
		"mcp_servers", hybridflowRunnerCfg.MCPServers,
		"toolbox_path", toolCfg.Prefix,
		"toolbox_catalog_path", toolCfg.CatalogDir,
		"max_upload_bytes", cfg.MaxUploadBytes,
	)
}
