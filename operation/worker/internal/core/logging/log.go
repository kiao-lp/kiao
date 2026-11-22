package logging

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
)

// Logger writes structured key=value lines to stdout.
var Logger = slog.New(slog.NewTextHandler(logSink, &slog.HandlerOptions{Level: slog.LevelInfo}))

// logSink is shared by all derived loggers, so attaching a file affects them all.
var logSink = &switchSink{w: os.Stdout}

// switchSink serializes writes and destination swaps to keep lines whole.
type switchSink struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *switchSink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

func (s *switchSink) set(w io.Writer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.w = w
}

// Logs can contain paths and request lines; restrict access to the owner.
const logFilePerm = 0o600

// InitLogFile appends logs to KIAO_WORKER_LOG_FILE as well as stdout.
// Unset or unopenable files leave stdout logging intact without failing startup.
func InitLogFile() {
	path := strings.TrimSpace(os.Getenv("KIAO_WORKER_LOG_FILE"))
	if path == "" {
		return
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, logFilePerm)
	if err != nil {
		LogMain.Warn("cannot open the log file; logging to stdout alone", "path", path, "error", err)
		return
	}
	logSink.set(io.MultiWriter(os.Stdout, file))
	LogMain.Info("logging to file", "path", path)
}

func Component(name string) *slog.Logger { return Logger.With("component", name) }

var (
	LogMain  = Component("files")
	LogAuth  = Component("auth")
	LogTrace = Component("trace") // per-request audit
)

func init() {
	slog.SetDefault(Logger)
}

type reqIDKey struct{}

func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, reqIDKey{}, id)
}

// RequestID returns the WithRequestID value, or "-" outside a request.
func RequestID(ctx context.Context) string {
	if id, ok := ctx.Value(reqIDKey{}).(string); ok {
		return id
	}
	return "-"
}

// LogCtx correlates feature logs with the request trace. Callers add component.
func LogCtx(r *http.Request) *slog.Logger {
	return Logger.With("request_id", RequestID(r.Context()))
}
