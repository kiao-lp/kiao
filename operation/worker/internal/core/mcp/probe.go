package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	"maps"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	checkTimeout    = 12 * time.Second
	protocolVersion = "2024-11-05"
	maxProbeReply   = 8 << 20
)

type probeError struct {
	stage string
	cause error
}

func (e *probeError) Error() string { return e.stage + ": " + e.cause.Error() }

type ProbeResult struct {
	Tools     int
	ToolBytes int
}

type rpcMessage struct {
	Version string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type probeTransport interface {
	exchange(method string, id int, params any) (json.RawMessage, error)
	setVersion(version string)
}

// Check runs the independent probes in parallel, with a single deadline for the batch.
func Check(ctx context.Context, dir string, servers []equipment.MCPServer, token string) []equipment.MCPDiagnostic {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	results := make([]equipment.MCPDiagnostic, len(servers))
	var pending sync.WaitGroup
	for i, server := range servers {
		pending.Go(func() { results[i] = check(ctx, dir, server, token) })
	}
	pending.Wait()
	return results
}

func check(ctx context.Context, dir string, server equipment.MCPServer, token string) equipment.MCPDiagnostic {
	result := equipment.MCPDiagnostic{Server: server.Name}
	lookup := func(key string) string {
		if key == "KIAO_MCP_TURN_TOKEN" {
			return token
		}
		return os.Getenv(key)
	}
	var missing []string
	server.Env = expandEnvironment(server.Env, lookup, &missing)
	server.Headers = expandEnvironment(server.Headers, lookup, &missing)
	if len(missing) > 0 {
		result.Stage = "environment"
		result.Message = "Set " + strings.Join(missing, ", ") + " on the runner."
		return result
	}
	server.Env["KIAO_MCP_DIAGNOSTIC"] = "1"
	probe, err := Probe(ctx, server, dir)
	if err != nil {
		result.Stage = err.stage
		result.Message = diagnosticText(server, err.cause.Error())
		return result
	}
	result.Available, result.Tools = true, probe.Tools
	return result
}

var envReference = regexp.MustCompile(`\$\{(?:env:)?([A-Za-z_][A-Za-z_0-9]*)(?::-([^}]*))?\}`)

func expandEnvironment(entries map[string]string, lookup func(string) string, missing *[]string) map[string]string {
	values := make(map[string]string, len(entries))
	for _, name := range slices.Sorted(maps.Keys(entries)) {
		values[name] = envReference.ReplaceAllStringFunc(entries[name], func(reference string) string {
			parts := envReference.FindStringSubmatchIndex(reference)
			key := reference[parts[2]:parts[3]]
			if value := lookup(key); value != "" {
				return value
			}
			if parts[4] >= 0 {
				return reference[parts[4]:parts[5]]
			}
			if !slices.Contains(*missing, key) {
				*missing = append(*missing, key)
			}
			return ""
		})
	}
	return values
}

// Probe checks the MCP protocol with an already configured environment.
func Probe(ctx context.Context, server equipment.MCPServer, dir string) (ProbeResult, *probeError) {
	if err := ctx.Err(); err != nil {
		return ProbeResult{}, &probeError{"launch", err}
	}
	if server.Type == equipment.MCPHTTP {
		transport := &httpProbe{ctx: ctx, url: server.URL, headers: server.Headers}
		defer transport.close()
		return handshake(transport)
	}
	child, err := startStdio(server, dir)
	if err != nil {
		return ProbeResult{}, &probeError{"launch", fmt.Errorf("cannot start %s: %w", server.Command, err)}
	}
	defer child.close()
	stop := context.AfterFunc(ctx, func() {
		_ = child.output.SetReadDeadline(time.Now())
		_ = child.input.Close()
		child.kill()
	})
	defer stop()
	probe, failure := handshake(&stdioProbe{child.input, probeScanner(child.output)})
	if failure != nil {
		child.close()
		if ctx.Err() != nil {
			failure.cause = ctx.Err()
		}
		failure.cause = child.explain(failure.cause, false)
	}
	return probe, failure
}

func handshake(transport probeTransport) (ProbeResult, *probeError) {
	body, err := transport.exchange("initialize", 1, map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]string{"name": "kiao-mcp-check", "version": "1"},
	})
	if err != nil {
		return ProbeResult{}, &probeError{"initialize", err}
	}
	var init struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if json.Unmarshal(body, &init) != nil || init.ProtocolVersion == "" {
		return ProbeResult{}, &probeError{"initialize", errors.New("invalid MCP initialize result (missing protocolVersion)")}
	}
	transport.setVersion(init.ProtocolVersion)
	if _, err := transport.exchange("notifications/initialized", 0, nil); err != nil {
		return ProbeResult{}, &probeError{"initialize", err}
	}
	body, err = transport.exchange("tools/list", 2, map[string]any{})
	if err != nil {
		return ProbeResult{}, &probeError{"tools/list", err}
	}
	var listed struct {
		Tools []json.RawMessage `json:"tools"`
	}
	if json.Unmarshal(body, &listed) != nil || listed.Tools == nil {
		return ProbeResult{}, &probeError{"tools/list", errors.New("invalid MCP tools/list result (expected a tools array)")}
	}
	result := ProbeResult{Tools: len(listed.Tools)}
	for _, tool := range listed.Tools {
		result.ToolBytes += len(tool)
	}
	return result, nil
}

func requestFrame(method string, id int, params any) []byte {
	request := map[string]any{"jsonrpc": "2.0", "method": method}
	if id != 0 {
		request["id"] = id
	}
	if params != nil {
		request["params"] = params
	}
	frame, _ := json.Marshal(request)
	return frame
}

func probeResult(frame []byte, id int) (json.RawMessage, error) {
	var msg rpcMessage
	if err := json.Unmarshal(frame, &msg); err != nil || msg.Version != "2.0" {
		return nil, errors.New("server sent invalid JSON-RPC")
	}
	if string(msg.ID) != fmt.Sprint(id) || msg.Method != "" {
		return nil, nil
	}
	if msg.Error != nil {
		return nil, fmt.Errorf("MCP error %d: %s", msg.Error.Code, msg.Error.Message)
	}
	if len(msg.Result) == 0 {
		return nil, errors.New("MCP response has no result")
	}
	return msg.Result, nil
}

type stdioProbe struct {
	input  io.Writer
	output *bufio.Scanner
}

func (s *stdioProbe) setVersion(string) {}

func (s *stdioProbe) exchange(method string, id int, params any) (json.RawMessage, error) {
	if err := writeFrame(s.input, requestFrame(method, id, params)); err != nil {
		return nil, err
	}
	if id == 0 {
		return nil, nil
	}
	for s.output.Scan() {
		if frame := s.output.Bytes(); len(frame) > 0 {
			if result, err := probeResult(frame, id); result != nil || err != nil {
				return result, err
			}
		}
	}
	if err := s.output.Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("server exited without answering")
}

func probeScanner(input io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 8192), maxProbeReply)
	return scanner
}

var turnTokenPattern = regexp.MustCompile(`kiao-turn\.[A-Za-z0-9_-]+`)

func diagnosticText(server equipment.MCPServer, message string) string {
	redact := func(value string) {
		if value != "" {
			message = strings.ReplaceAll(message, value, "[redacted]")
		}
	}
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		if secretKey(key) {
			redact(value)
		}
	}
	for key, value := range server.Env {
		if secretKey(key) {
			redact(value)
		}
	}
	for _, value := range server.Headers {
		redact(value)
		if _, token, ok := strings.Cut(value, " "); ok {
			redact(token)
		}
	}
	if remote, err := url.Parse(server.URL); err == nil && remote.Host != "" {
		for _, values := range remote.Query() {
			for _, value := range values {
				redact(value)
			}
		}
		if remote.User != nil {
			redact(remote.User.String())
			password, _ := remote.User.Password()
			redact(password)
		}
	}
	message = turnTokenPattern.ReplaceAllString(message, "[redacted]")
	message = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, message)
	const limit = 2400
	if runes := []rune(message); len(runes) > limit {
		message = string(runes[:400]) + "\n…\n" + string(runes[len(runes)-(limit-400):])
	}
	return strings.TrimSpace(message)
}

func secretKey(key string) bool {
	key = strings.ToUpper(key)
	for _, word := range []string{"TOKEN", "PASSWORD", "SECRET", "API_KEY", "APIKEY", "CREDENTIAL", "AUTHORIZATION", "COOKIE"} {
		if strings.Contains(key, word) {
			return true
		}
	}
	return false
}
