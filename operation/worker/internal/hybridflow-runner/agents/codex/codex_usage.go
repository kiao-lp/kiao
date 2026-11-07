package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// CodexUsageService caches account rate limits for usageCacheTTL.
type CodexUsageService struct {
	mu       sync.Mutex
	Cached   *agentapi.AgentUsageDto
	CachedAt time.Time

	// Injectable app-server probe; returns the rate-limits result.
	Probe func() ([]byte, error)
}

// Bound the entire exchange, including any backend fetch by the CLI.
const codexUsageTimeout = 20 * time.Second

// Match response IDs because server notifications may arrive between answers.
const codexInitializeID = 1

const codexRateLimitsID = 2

const codexRateLimitsRPC = "account/rateLimits/read"

func newCodexUsageService() *CodexUsageService {
	svc := &CodexUsageService{}
	svc.Probe = svc.ask
	return svc
}

// Errors surface as HTTP 503; the panel retains its previous figures.
func (svc *CodexUsageService) GetUsage() (agentapi.AgentUsageDto, error) {
	svc.mu.Lock()
	if svc.Cached != nil && time.Since(svc.CachedAt) < agentapi.UsageCacheTTL {
		dto := *svc.Cached
		svc.mu.Unlock()
		return dto, nil
	}
	svc.mu.Unlock()

	raw, err := svc.Probe()
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}
	dto, err := CodexUsageFrom(raw)
	if err != nil {
		return agentapi.AgentUsageDto{}, err
	}

	svc.mu.Lock()
	svc.Cached = &dto
	svc.CachedAt = time.Now()
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
func CodexUsageFrom(raw []byte) (agentapi.AgentUsageDto, error) {
	var result codexRateLimitsResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return agentapi.AgentUsageDto{}, fmt.Errorf("the Codex rate-limit answer could not be read: %w", err)
	}
	dto := agentapi.AgentUsageDto{}
	for _, window := range []*codexRateLimitWindow{result.RateLimits.Primary, result.RateLimits.Secondary} {
		if window == nil {
			continue
		}
		dto.Windows = append(dto.Windows, agentapi.AgentWindow{
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

	cmd := exec.CommandContext(ctx, CodexBinaryName, "app-server")
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
