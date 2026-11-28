package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"kiao/worker/internal/core/equipment"
	"os"
	"sync"
)

const relayCommand = "--kiao-mcp-stdio-relay"

func RelayStdio(servers []equipment.MCPServer) ([]equipment.MCPServer, error) {
	if len(servers) == 0 {
		return servers, nil
	}
	worker, err := os.Executable()
	if err != nil {
		return nil, err
	}
	wrapped := make([]equipment.MCPServer, 0, len(servers))
	for _, server := range servers {
		if server.Type == equipment.MCPStdio {
			server.Args = append([]string{relayCommand, server.Name, server.Command}, server.Args...)
			server.Command = worker
		}
		wrapped = append(wrapped, server)
	}
	return wrapped, nil
}

func RunStdioRelay() bool {
	if len(os.Args) < 2 || os.Args[1] != relayCommand {
		return false
	}
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "MCP relay requires a server name and command")
		os.Exit(2)
	}
	server := equipment.MCPServer{Name: os.Args[2], Command: os.Args[3], Args: os.Args[4:]}
	if err := relayStdio(server, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, diagnosticText(server, err.Error()))
		os.Exit(1)
	}
	return true
}

type stdioRelay struct {
	mu      sync.Mutex // serializes replies and changes to the outstanding requests
	output  io.Writer
	pending map[string]rpcMessage
	failure string
}

// Keep the MCP connection alive after the tool process exits so outstanding calls
// are delivered as tool errors. A failed call may have changed state, so it is never replayed.
func relayStdio(server equipment.MCPServer, input io.Reader, output io.Writer) error {
	relay := &stdioRelay{output: output, pending: make(map[string]rpcMessage)}
	child, err := startStdio(server, "")
	if err != nil {
		relay.failure = diagnosticText(server, fmt.Sprintf("MCP server %q could not start: %v", server.Name, err))
		return readFrames(input, func(_ []byte, messages []rpcMessage) error {
			return relay.toServer(nil, nil, messages)
		})
	}
	ended := make(chan struct{})
	go func() {
		defer close(ended)
		err := readFrames(child.output, relay.fromServer)
		child.close()
		cause := fmt.Errorf("MCP server %q stopped responding", server.Name)
		if err != nil {
			cause = fmt.Errorf("%w: %v", cause, err)
		}
		relay.fail(diagnosticText(server, child.explain(cause, true).Error()))
	}()
	err = readFrames(input, func(frame []byte, messages []rpcMessage) error {
		return relay.toServer(child, frame, messages)
	})
	child.close()
	<-ended
	return err
}

func (r *stdioRelay) fromServer(frame []byte, messages []rpcMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, msg := range messages {
		if msg.Method == "" {
			delete(r.pending, requestID(msg.ID))
		}
	}
	return writeFrame(r.output, frame)
}

func (r *stdioRelay) toServer(child *stdioProcess, frame []byte, messages []rpcMessage) error {
	r.mu.Lock()
	if r.failure != "" {
		defer r.mu.Unlock()
		for _, msg := range messages {
			if msg.Method != "" && requestID(msg.ID) != "" {
				if err := r.replyFailed(msg); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, msg := range messages {
		if id := requestID(msg.ID); id != "" && msg.Method != "" {
			r.pending[id] = msg
		}
	}
	r.mu.Unlock()
	if err := writeFrame(child.input, frame); err != nil {
		// The reader drains the final replies before marking the remaining calls failed.
		child.kill()
	}
	return nil
}

func (r *stdioRelay) fail(reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.failure = reason
	for _, msg := range r.pending {
		if r.replyFailed(msg) != nil {
			break
		}
	}
	clear(r.pending)
}

func (r *stdioRelay) replyFailed(msg rpcMessage) error {
	reply := map[string]any{"jsonrpc": "2.0", "id": msg.ID}
	if msg.Method == "tools/call" {
		reply["result"] = map[string]any{
			"isError": true,
			"content": []map[string]string{{"type": "text", "text": r.failure}},
		}
	} else {
		reply["error"] = map[string]any{"code": -32000, "message": r.failure}
	}
	return json.NewEncoder(r.output).Encode(reply)
}

func requestID(id json.RawMessage) string {
	if len(id) == 0 || string(id) == "null" {
		return ""
	}
	if id[0] == '"' {
		var decoded string
		_ = json.Unmarshal(id, &decoded)
		return "\"" + decoded
	}
	return string(id)
}

func readFrames(input io.Reader, receive func([]byte, []rpcMessage) error) error {
	reader := bufio.NewReader(input)
	for {
		line, err := reader.ReadBytes('\n')
		if frame := bytes.TrimSpace(line); len(frame) > 0 {
			messages := make([]rpcMessage, 1)
			if frame[0] == '[' {
				if json.Unmarshal(frame, &messages) != nil {
					return errors.New("invalid MCP frame")
				}
			} else if json.Unmarshal(frame, &messages[0]) != nil {
				return errors.New("invalid MCP frame")
			}
			if err := receive(frame, messages); err != nil {
				return err
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
