package muse

import (
	"bufio"
	"context"
	"crypto/rand"
	pkgBinary "encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	"os/exec"
	"sync"
	"time"
)

// MSP command idempotency handles must be UUIDv7; UUIDv4 is rejected as invalid params.
func MspCommandID() string {
	var id [16]byte
	now := uint64(time.Now().UnixMilli())
	pkgBinary.BigEndian.PutUint64(id[0:8], now<<16)
	if _, err := rand.Read(id[6:8]); err != nil {
		pkgBinary.BigEndian.PutUint16(id[6:8], uint16(now))
	}
	if _, err := rand.Read(id[8:]); err != nil {
		copy(id[8:], id[0:8])
	}
	id[6] = id[6]&0x0f | 0x70 // version 7
	id[8] = id[8]&0x3f | 0x80 // variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		pkgBinary.BigEndian.Uint32(id[0:4]), pkgBinary.BigEndian.Uint16(id[4:6]),
		pkgBinary.BigEndian.Uint16(id[6:8]), pkgBinary.BigEndian.Uint16(id[8:10]), id[10:16])
}

// Unknown host notifications must be tolerated, including ones absent from the schema.
type MspNotification struct {
	Method string
	Params json.RawMessage
}

// Kind is the MSP error discriminator (e.g. notInitialized, invalidParams).
type mspError struct {
	Code    int
	Message string
	Kind    string
}

func (e *mspError) Error() string {
	if e.Kind != "" {
		return fmt.Sprintf("muse %s: %s", e.Kind, e.Message)
	}
	return fmt.Sprintf("muse error %d: %s", e.Code, e.Message)
}

type MspConn struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	// Serialises writes from callers and the reader, including replies to host requests.
	writeMu sync.Mutex

	mu      sync.Mutex
	nextID  int
	pending map[int]chan mspResult

	// Nil for non-turn hosts. Records the full exchange, including items the relay ignores.
	trace *turntrace.TurnTrace
	// Flush partial stderr lines after the child is reaped.
	stderrOut *turntrace.TraceLineWriter

	// Buffered notifications preserve arrival order while the consumer handles earlier ones.
	notifs chan MspNotification
	// Closed when the stdout reader exits; readErr distinguishes failure from EOF.
	done    chan struct{}
	ReadErr error
}

// A JSON-RPC response carries either a result or an error.
type mspResult struct {
	result json.RawMessage
	err    *mspError
}

// Bound each newline-delimited frame; completed transcript items may contain large tool results.
const mspBufferSize = 8 * 1024 * 1024

// spawnMSP must send `initialize`, then `initialized`; other methods are refused until then.
// The caller supplies working directory and environment (nil env inherits the parent).
// A nil trace discards stderr.
func SpawnMSP(ctx context.Context, binary string, args []string, dir string, env []string, trace *turntrace.TurnTrace) (*MspConn, error) {
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = dir
	cmd.Env = env
	// Use a writer rather than an undrained pipe to avoid blocking on stderr.
	stderrOut := trace.StderrWriter()
	if stderrOut != nil {
		cmd.Stderr = stderrOut
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("the Muse host could not be started: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, fmt.Errorf("the Muse host could not be started: %w", err)
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, fmt.Errorf("the Muse host could not be started: %w", err)
	}
	conn := &MspConn{
		cmd: cmd, stdin: stdin,
		trace: trace, stderrOut: stderrOut,
		pending: map[int]chan mspResult{},
		notifs:  make(chan MspNotification, 256),
		done:    make(chan struct{}),
	}
	go conn.read(stdout)
	if _, err := conn.Call("initialize", map[string]any{
		"clientInfo":         map[string]any{"name": "kiao", "version": "1.0.0"},
		"clientCapabilities": map[string]any{},
	}); err != nil {
		conn.Close()
		return nil, err
	}
	if err := conn.notify("initialized", map[string]any{}); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

// call returns *mspError for protocol errors and fails if the host exits before answering.
func (c *MspConn) Call(method string, params any) (json.RawMessage, error) {
	return c.callTimeout(method, params, 0)
}

// A zero timeout waits indefinitely. Timed-out requests are removed so late replies are dropped.
func (c *MspConn) callTimeout(method string, params any, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	answer := make(chan mspResult, 1)
	c.pending[id] = answer
	c.mu.Unlock()

	if err := c.send(map[string]any{
		"jsonrpc": "2.0", "id": id, "method": method, "params": params,
	}); err != nil {
		c.dropPending(id)
		return nil, err
	}
	var fellSilent <-chan time.Time
	if timeout > 0 {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		fellSilent = timer.C
	}
	select {
	case result := <-answer:
		if result.err != nil {
			return nil, result.err
		}
		return result.result, nil
	case <-c.done:
		return nil, errors.New("the Muse host ended before answering")
	case <-fellSilent:
		c.dropPending(id)
		return nil, fmt.Errorf("the Muse host did not answer %s within %s", method, timeout)
	}
}

func (c *MspConn) notify(method string, params any) error {
	return c.send(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (c *MspConn) send(frame map[string]any) error {
	line, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	c.trace.StreamLine(turntrace.TraceIn, string(line))
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err = c.stdin.Write(append(line, '\n'))
	return err
}

func (c *MspConn) dropPending(id int) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

// readError distinguishes clean EOF from scanner failure, including oversized frames.
func (c *MspConn) ReadError() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ReadErr
}

// The sole stdout reader preserves notification arrival order.
func (c *MspConn) read(stdout io.Reader) {
	defer close(c.done)
	defer close(c.notifs)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), mspBufferSize)
	for scanner.Scan() {
		line := scanner.Text()
		// Trace before filtering so ignored items and other turns' stragglers are retained.
		c.trace.StreamLine(turntrace.TraceOut, line)
		var frame struct {
			ID     *int            `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
				Data    struct {
					Kind string `json:"kind"`
				} `json:"data"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			// Ignore stray launcher warnings; a valid response may follow.
			continue
		}
		switch {
		case frame.Method != "" && frame.ID == nil:
			c.notifs <- MspNotification{Method: frame.Method, Params: frame.Params}
		case frame.ID != nil && frame.Method == "":
			c.mu.Lock()
			answer, ok := c.pending[*frame.ID]
			if ok {
				delete(c.pending, *frame.ID)
			}
			c.mu.Unlock()
			if !ok {
				continue
			}
			result := mspResult{result: frame.Result}
			if frame.Error != nil {
				result.err = &mspError{
					Code: frame.Error.Code, Message: frame.Error.Message,
					Kind: frame.Error.Data.Kind,
				}
			}
			answer <- result
		case frame.Method != "" && frame.ID != nil:
			// Host requests are unsupported; reply with an error so the host does not wait forever.
			id := *frame.ID
			_ = c.send(map[string]any{"jsonrpc": "2.0", "id": id,
				"error": map[string]any{"code": -32601, "message": "method not found"}})
		}
	}
	if err := scanner.Err(); err != nil {
		c.mu.Lock()
		c.ReadErr = err
		c.mu.Unlock()
	}
}

// close closes stdin, kills and reaps the child. Stop, turn completion and failed handshakes
// may all call it; repeated calls ignore close/kill/wait errors.
func (c *MspConn) Close() {
	_ = c.stdin.Close()
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_ = c.cmd.Wait()
	}
	// Wait joins the stderr copier before flushing an unterminated line.
	c.stderrOut.Flush()
}
