package hybridflowrunner

import (
	"kiao/worker/internal/core"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Browser sockets are long-lived and multiplex conversations. Heartbeats detect vanished
// browsers and avoid proxy idle timeouts; write deadlines keep slow readers from stalling turns.

const (
	pingInterval = 30 * time.Second
	// Allow a missed pong while detecting disconnects before the proxy idle timeout.
	pongTimeout = 75 * time.Second
	// Bound writes so a wedged browser cannot stall a turn goroutine.
	writeTimeout = 10 * time.Second
	maxIncomingFrameBytes = 1 << 20
)

// wsConn serializes writes because gorilla connections are not write-safe.
type wsConn struct {
	conn *websocket.Conn
	id   string
	user string

	writeMu sync.Mutex
	// Guarded by ClaudeHub.mu, not writeMu, to keep both subscription maps consistent.
	subs map[string]struct{}

	closeOnce sync.Once
	// Closed by close() to stop the heartbeat immediately.
	done chan struct{}
}

func newWSConn(conn *websocket.Conn, user string) *wsConn {
	return &wsConn{
		conn: conn,
		id:   core.RandID(),
		user: user,
		subs: map[string]struct{}{},
		done: make(chan struct{}),
	}
}

func (c *wsConn) sendJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return c.conn.WriteJSON(v)
}

// WriteMessage must share the JSON writer lock to avoid interleaved frames.
func (c *wsConn) ping() error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return c.conn.WriteMessage(websocket.PingMessage, nil)
}

// Read, heartbeat and fan-out goroutines may all close the socket. Closing the connection
// unblocks the read loop, which eventually removes its subscriptions.
func (c *wsConn) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

// Failed pings close the socket to release subscriptions promptly.
func (h *ClaudeHub) heartbeat(c *wsConn) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			if err := c.ping(); err != nil {
				logClaudeWS.Info("ping failed, closing the socket", "socket", c.id, "error", err)
				c.close()
				return
			}
		}
	}
}

// Conversation-list updates go to every open socket, including unsubscribed ones.
func (h *ClaudeHub) addConn(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c.id] = c
}

func (h *ClaudeHub) dropConn(c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c.id)
}
