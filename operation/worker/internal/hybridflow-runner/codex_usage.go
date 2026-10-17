package hybridflowrunner

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Account quota comes from `codex app-server` JSON-RPC; exec reports only per-turn usage.
// This read costs no model tokens. Handshake: initialize response, initialized notification,
// then account/rateLimits/read. Kill the server after the answer.
// Window durations are plan-dependent minutes, not fixed five-hour/weekly assumptions.

// CodexUsageService caches account rate limits for usageCacheTTL.
type CodexUsageService struct {
	mu       sync.Mutex
	cached   *AgentUsageDto
	cachedAt time.Time

	// Injectable app-server probe; returns the rate-limits result.
	probe func() ([]byte, error)
}

const (
	// Bound the entire exchange, including any backend fetch by the CLI.
	codexUsageTimeout = 20 * time.Second
	// Match response IDs because server notifications may arrive between answers.
	codexInitializeID  = 1
	codexRateLimitsID  = 2
	codexRateLimitsRPC = "account/rateLimits/read"
)

func newCodexUsageService() *CodexUsageService {
	svc := &CodexUsageService{}
	svc.probe = svc.ask
	return svc
}

// Errors surface as HTTP 503; the panel retains its previous figures.
func (svc *CodexUsageService) getUsage() (AgentUsageDto, error) {
	svc.mu.Lock()
	if svc.cached != nil && time.Since(svc.cachedAt) < usageCacheTTL {
		dto := *svc.cached
		svc.mu.Unlock()
		return dto, nil
	}
	svc.mu.Unlock()

	raw, err := svc.probe()
	if err != nil {
		return AgentUsageDto{}, err
	}
	dto, err := codexUsageFrom(raw)
	if err != nil {
		return AgentUsageDto{}, err
	}

	svc.mu.Lock()
	svc.cached = &dto
	svc.cachedAt = time.Now()
	svc.mu.Unlock()
	return dto, nil
}

type codexRateLimitsResult struct {
	RateLimits struct {
		// Primary is the tighter window, Secondary the wider; either may be absent.
		Primary   *codexRateLimitWindow `json:"primary"`
		Secondary *codexRateLimitWindow `json:"secondary"`
	} `json:"rateLimits"`
}

// Missing duration/reset fields decode as zero (unspecified). Units: minutes and Unix seconds.
type codexRateLimitWindow struct {
	UsedPercent        int   `json:"usedPercent"`
	WindowDurationMins int   `json:"windowDurationMins"`
	ResetsAt           int64 `json:"resetsAt"`
}

// No windows is a valid answer: quota unavailable, not a CLI communication failure.
func codexUsageFrom(raw []byte) (AgentUsageDto, error) {
	var result codexRateLimitsResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return AgentUsageDto{}, fmt.Errorf("the Codex rate-limit answer could not be read: %w", err)
	}
	dto := AgentUsageDto{}
	for _, window := range []*codexRateLimitWindow{result.RateLimits.Primary, result.RateLimits.Secondary} {
		if window == nil {
			continue
		}
		dto.Windows = append(dto.Windows, agentWindow{
			WindowMinutes:       window.WindowDurationMins,
			PercentUsed:         window.UsedPercent,
			ResetAtEpochSeconds: window.ResetsAt,
		})
	}
	return dto, nil
}

// ask returns the rate-limit result verbatim, then kills the one-question app server.
// Discard stderr progress notices; only stdout carries RPC answers.
func (svc *CodexUsageService) ask() ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), codexUsageTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, codexBinaryName, "app-server")
	cmd.Stderr = nil
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, codexUsageUnavailable(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, codexUsageUnavailable(err)
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, codexUsageUnavailable(err)
	}
	// Always kill and reap, including on timeout or protocol failure.
	defer func() {
		cancel()
		_ = cmd.Wait()
	}()

	send := func(message any) error {
		line, err := json.Marshal(message)
		if err != nil {
			return err
		}
		_, err = stdin.Write(append(line, '\n'))
		return err
	}
	if err := send(map[string]any{
		"jsonrpc": "2.0", "id": codexInitializeID, "method": "initialize",
		"params": map[string]any{"clientInfo": map[string]any{
			"name": "kiao", "title": "KIAO", "version": "1.0.0"}},
	}); err != nil {
		return nil, codexUsageUnavailable(err)
	}

	reader := bufio.NewScanner(stdout)
	reader.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	// Wait for initialize before sending requests; codexAwait skips interleaved notifications.
	if _, err := codexAwait(reader, codexInitializeID); err != nil {
		return nil, err
	}
	if err := send(map[string]any{"jsonrpc": "2.0", "method": "initialized", "params": map[string]any{}}); err != nil {
		return nil, codexUsageUnavailable(err)
	}
	if err := send(map[string]any{
		"jsonrpc": "2.0", "id": codexRateLimitsID, "method": codexRateLimitsRPC,
		"params": map[string]any{},
	}); err != nil {
		return nil, codexUsageUnavailable(err)
	}
	result, err := codexAwait(reader, codexRateLimitsID)
	if err != nil {
		return nil, err
	}
	// Keep stdin open until the answer arrives; EOF terminates the server.
	_ = stdin.Close()
	return result, nil
}

// Messages without an id are notifications and must be skipped.
type codexRPCMessage struct {
	ID     *int            `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func codexAwait(reader *bufio.Scanner, id int) (json.RawMessage, error) {
	for reader.Scan() {
		line := strings.TrimSpace(reader.Text())
		if line == "" {
			continue
		}
		var message codexRPCMessage
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			// Ignore unparseable lines; the matching response may still follow.
			continue
		}
		if message.ID == nil || *message.ID != id {
			continue
		}
		if message.Error != nil {
			return nil, fmt.Errorf("the Codex app server refused %s: %s", codexRateLimitsRPC, message.Error.Message)
		}
		return message.Result, nil
	}
	if err := reader.Err(); err != nil && !errors.Is(err, io.EOF) {
		return nil, codexUsageUnavailable(err)
	}
	return nil, errors.New("the Codex app server ended without answering; the CLI may not be signed in")
}

func codexUsageUnavailable(err error) error {
	return fmt.Errorf("the Codex app server could not be asked for the account's limits: %w", err)
}
