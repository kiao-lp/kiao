package runnerhttp

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"kiao/worker/internal/core/access"
	"kiao/worker/internal/core/logging"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	turnevents "kiao/worker/internal/hybridflow-runner/turns/events"
	"net/http"
	"time"
)

type SocketHandler struct {
	*pkgTurns.Engine
	upgrader websocket.Upgrader
}

func newSocketHandler(hub *pkgTurns.Engine) *SocketHandler {
	return &SocketHandler{Engine: hub, upgrader: websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}}
}

type websocketConnection struct{ *websocket.Conn }

func (c *websocketConnection) WriteJSON(v any) error {
	_ = c.SetWriteDeadline(time.Now().Add(writeTimeout))
	return c.Conn.WriteJSON(v)
}

func (c *websocketConnection) Ping() error {
	_ = c.SetWriteDeadline(time.Now().Add(writeTimeout))
	return c.WriteMessage(websocket.PingMessage, nil)
}

func newWSConn(conn *websocket.Conn, user string) *turnevents.Client {
	return turnevents.NewClient(&websocketConnection{conn}, user)
}

const pingInterval = 30 * time.Second

// Allow a missed pong while detecting disconnects before the proxy idle timeout.
const pongTimeout = 75 * time.Second

// Bound writes so a wedged browser cannot stall a turn goroutine.
const writeTimeout = 10 * time.Second

const maxIncomingFrameBytes = 1 << 20

func (h *SocketHandler) handle(w http.ResponseWriter, r *http.Request) {
	reqID := logging.RequestID(r.Context())
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		agentapi.LogClaudeWS.Warn("upgrade failed", "request_id", reqID, "error", err)
		return
	}

	id := access.IdentityFromRequest(r)
	c := newWSConn(conn, id.User)
	h.AddConn(c)
	agentapi.LogClaudeWS.Info("connected", "user", id.User, "socket", c.Id, "request_id", reqID)
	defer h.AfterConnectionClosed(c, id)

	conn.SetReadLimit(maxIncomingFrameBytes)
	_ = conn.SetReadDeadline(time.Now().Add(pongTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongTimeout))
	})
	go h.heartbeat(c)

	// Send hello first so reconnecting clients learn the protocol and running turns before asking.
	if err := c.SendJSON(h.HelloFrame(c)); err != nil {
		return
	}

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg pkgTurns.Command
		if err := json.Unmarshal(data, &msg); err != nil {
			agentapi.LogClaudeWS.Warn("message parse failed", "user", id.User, "socket", c.Id, "error", err)
			continue
		}
		switch msg.Type {
		case "subscribe":
			h.HandleSubscribe(c, id, msg)
		case "unsubscribe":
			h.HandleUnsubscribe(c, msg)
		case "prompt":
			h.HandlePrompt(c, id, msg)
		case "between":
			h.HandleBetween(c, id, msg)
		case "follow_up", "clear_queue":
			h.HandleDeferred(c, id, msg)
		case "stop":
			h.HandleStop(c, id, msg)
		case "permission_decision":
			h.HandlePermissionDecision(c, id, msg)
		case "question_answer":
			h.HandleQuestionAnswer(c, id, msg)
		default:
			agentapi.LogClaudeWS.Warn("unknown message type", "user", id.User, "socket", c.Id, "type", msg.Type)
		}
	}
}

// Failed pings close the socket to release subscriptions promptly.
func (h *SocketHandler) heartbeat(c *turnevents.Client) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.Done:
			return
		case <-ticker.C:
			if err := c.Ping(); err != nil {
				agentapi.LogClaudeWS.Info("ping failed, closing the socket", "socket", c.Id, "error", err)
				c.Close()
				return
			}
		}
	}
}
