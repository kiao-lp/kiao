// Package logging provides process-wide key=value logging to stdout with component tags.
// Core packages must not depend on logging.
// The folder name avoids `log` and `logs`, which .gitignore excludes everywhere.
package logging

import (
	"context"
	"log/slog"
	"os"
)

// Logger uses text for journald and grep.
var Logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

func Component(name string) *slog.Logger { return Logger.With("component", name) }

// Cache component loggers to avoid per-call allocation.
var (
	Main = Component("hybridflow")
	DB   = Component("db")
	Auth = Component("auth")
	HTTP = Component("http")
)

func init() { slog.SetDefault(Logger) }

type reqIDKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, reqIDKey{}, id)
}

// RequestID returns "-" outside a request.
func RequestID(ctx context.Context) string {
	if id, ok := ctx.Value(reqIDKey{}).(string); ok {
		return id
	}
	return "-"
}

// Ctx adds the request ID; callers add their component.
func Ctx(ctx context.Context) *slog.Logger { return Logger.With("request_id", RequestID(ctx)) }
