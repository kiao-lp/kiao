package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const healthyStdio = `while IFS= read -r line; do
case "$line" in
  *'"method":"initialize"'*) echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}';;
  *'"method":"tools/list"'*) echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"run","inputSchema":{"type":"object"}}]}}';;
esac
done`

func TestStdioChecksPresenceAndRunsInternalDiagnostic(t *testing.T) {
	t.Setenv("CHECK_API_KEY", "private-key-from-runner")
	command := filepath.Join(t.TempDir(), "disappeared")
	servers := []equipment.MCPServer{
		{Name: "healthy", Command: "/bin/sh", Args: []string{"-c", healthyStdio}},
		{Name: "absent", Command: command},
		{Name: "internal", Command: "/bin/sh", Args: []string{"-c", `
if [ "$KIAO_MCP_DIAGNOSTIC" = 1 ]; then
  echo "Upstream service refused connection ($CHECK_API_KEY)" >&2
  exit 7
fi
` + healthyStdio}},
		{Name: "environment", Env: map[string]string{"KEY": "${KIAO_MCP_TEST_MISSING_AUTH}"}},
	}
	t.Setenv("KIAO_MCP_TEST_MISSING_AUTH", "")
	out := Check(t.Context(), t.TempDir(), servers, "")
	if !out[0].Available || out[0].Tools != 1 {
		t.Fatalf("healthy server: %+v", out[0])
	}
	if out[1].Stage != "launch" || !strings.Contains(out[1].Message, command) {
		t.Fatalf("missing command: %+v", out[1])
	}
	if out[2].Available || !strings.Contains(out[2].Message, "Upstream service refused connection") || strings.Contains(out[2].Message, "private-key-from-runner") {
		t.Fatalf("internal diagnostic: %+v", out[2])
	}
	if out[3].Stage != "environment" || !strings.Contains(out[3].Message, "KIAO_MCP_TEST_MISSING_AUTH") {
		t.Fatalf("missing environment: %+v", out[3])
	}
}

func TestHTTPCheckUsesHeadersAndSessionWithEventStream(t *testing.T) {
	t.Setenv("KIAO_TEST_MCP_TOKEN", "check-token")
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer check-token" {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodDelete {
			if r.Header.Get("Mcp-Session-Id") != "diagnostic-session" {
				t.Error("missing session at cleanup")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var frame rpcMessage
		if err := json.NewDecoder(r.Body).Decode(&frame); err != nil {
			t.Error(err)
			return
		}
		if frame.Method == "initialize" {
			w.Header().Set("Mcp-Session-Id", "diagnostic-session")
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}`)
			return
		}
		if r.Header.Get("Mcp-Session-Id") != "diagnostic-session" || r.Header.Get("Mcp-Protocol-Version") != "2025-03-26" {
			t.Error("missing negotiated headers")
		}
		if frame.Method == "notifications/initialized" {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n")
	}))
	defer remote.Close()
	servers := []equipment.MCPServer{
		{Name: "stream", Type: equipment.MCPHTTP, URL: remote.URL, Headers: map[string]string{"Authorization": "Bearer ${KIAO_TEST_MCP_TOKEN}"}},
		{Name: "denied", Type: equipment.MCPHTTP, URL: remote.URL},
	}
	results := Check(t.Context(), "", servers, "")
	if !results[0].Available || results[1].Stage != "initialize" || !strings.Contains(results[1].Message, "401") {
		t.Fatalf("HTTP checks: %+v", results)
	}
}

func TestProbeStopsUnresponsiveProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	_, err := Probe(ctx, equipment.MCPServer{Command: "/bin/sh", Args: []string{"-c", "sleep 30"}}, "")
	if err == nil || !strings.Contains(err.Error(), "deadline exceeded") {
		t.Fatalf("timeout: %v", err)
	}
}

func TestStdioCrashReturnsToolErrorsWithoutClosingConnection(t *testing.T) {
	script := `while IFS= read -r line; do
case "$line" in
  *'"id":1'*) echo '{"jsonrpc":"2.0","id":1,"result":{}}';;
	  *'"id":3'*) echo "Binary crashed during work ($RELAY_TEST_TOKEN)" >&2; exit 7;;
esac
done`
	t.Setenv("RELAY_TEST_TOKEN", "not-in-result")
	input, requests, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer requests.Close()
	replies, output, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer replies.Close()
	defer output.Close()
	_ = replies.SetReadDeadline(time.Now().Add(3 * time.Second))
	done := make(chan error, 1)
	go func() {
		done <- relayStdio(equipment.MCPServer{Name: "crashing", Command: "/bin/sh", Args: []string{"-c", script}}, input, output)
	}()
	read := bufio.NewReader(replies)
	call := func(id int) {
		t.Helper()
		if err := writeFrame(requests, requestFrame("tools/call", id, map[string]string{"name": "run"})); err != nil {
			t.Fatal(err)
		}
	}
	response := func() string {
		t.Helper()
		line, err := read.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		return line
	}
	call(1)
	if line := response(); !strings.Contains(line, `"id":1,"result":{}`) {
		t.Fatalf("reply before crash: %s", line)
	}
	call(2)
	call(3)
	for range 2 {
		if line := response(); !strings.Contains(line, `"isError":true`) || !strings.Contains(line, "Binary crashed during work") || strings.Contains(line, "not-in-result") {
			t.Fatalf("pending tool result: %s", line)
		}
	}
	call(4)
	if line := response(); !strings.Contains(line, `"id":4`) || !strings.Contains(line, `"isError":true`) {
		t.Fatalf("new call after crash: %s", line)
	}
	requests.Close()
	select {
	case err := <-done:
		if err != nil && err != io.EOF {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("relay kept running after the client disconnected")
	}
}
