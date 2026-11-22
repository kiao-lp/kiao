package muse

import (
	"sync"

	harnessapi "kiao/worker/internal/hybridflow-runner/harnesses"
	pkgProtocol "kiao/worker/internal/hybridflow-runner/harnesses/protocol"
)

// museHost owns the connection and native turn identity shared with control calls.
// mu also protects token accounting: a completion or retry changes both together.
// Callers release mu before RPC, process shutdown or event delivery. No other
// driver lock may be held while acquiring it.
type museHost struct {
	mu         sync.Mutex
	conn       *MspConn
	stopped    bool
	sessionID  string
	turnID     string
	lastTurnID string
	compacting bool
	tokens     museTokenUsage
}

// museHostSnapshot carries values only; it never exposes the host's mutex or accounting.
type museHostSnapshot struct {
	conn       *MspConn
	stopped    bool
	sessionID  string
	turnID     string
	lastTurnID string
	compacting bool
}

func (h *museHost) snapshot() museHostSnapshot {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked()
}

func (h *museHost) snapshotLocked() museHostSnapshot {
	return museHostSnapshot{
		conn: h.conn, stopped: h.stopped, sessionID: h.sessionID,
		turnID: h.turnID, lastTurnID: h.lastTurnID, compacting: h.compacting,
	}
}

func (h *museHost) setConnection(conn *MspConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conn = conn
}

func (h *museHost) opened(sessionID, turnID string, compacting bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sessionID, h.turnID, h.compacting = sessionID, turnID, compacting
}

func (h *museHost) stop() (museHostSnapshot, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopped {
		return museHostSnapshot{}, false
	}
	h.stopped = true
	return h.snapshotLocked(), true
}

func (h *museHost) interrupt() museHostSnapshot {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.turnID = ""
	return h.snapshotLocked()
}

func (h *museHost) endTurn() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastTurnID, h.turnID = h.turnID, ""
}

func (h *museHost) restart(turnID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.turnID = turnID
	h.tokens.restart()
}

func (h *museHost) completeUsage(params map[string]any) *harnessapi.TurnUsage {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.tokens.complete(params)
}

func (h *museHost) completeTurn(params map[string]any) *harnessapi.TurnUsage {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastTurnID, h.turnID = h.turnID, ""
	return h.tokens.complete(params)
}

func (h *museHost) ownsTurn(params map[string]any) bool {
	state := h.snapshot()
	turnID := pkgProtocol.AsString(params["turnId"])
	return turnID == "" || turnID == state.turnID || turnID == state.lastTurnID
}

// noteTokenUsage retains completed model calls even if the host later fails.
func (h *museHost) noteTokenUsage(params map[string]any) *harnessapi.TurnUsage {
	h.mu.Lock()
	defer h.mu.Unlock()
	turnID := pkgProtocol.AsString(params["turnId"])
	if h.compacting {
		if session := pkgProtocol.AsString(params["sessionId"]); session != "" && h.sessionID != "" && session != h.sessionID {
			return nil
		}
		if h.turnID != "" && turnID != h.turnID {
			return nil
		}
	} else if turnID == "" || (turnID != h.turnID && !(h.turnID == "" && turnID == h.lastTurnID)) {
		return nil
	}
	return h.tokens.noteModel(params, h.turnID == "" && !h.compacting)
}

func (h *museHost) noteChildUsage(item map[string]any) *harnessapi.TurnUsage {
	h.mu.Lock()
	defer h.mu.Unlock()
	turnID := pkgProtocol.AsString(item["turnId"])
	if h.compacting || turnID == "" || (turnID != h.turnID && turnID != h.lastTurnID) {
		return nil
	}
	return h.tokens.noteChild(item)
}

// takeTurnUsage clears the running native turn's bill; nil means unknown usage.
func (h *museHost) takeTurnUsage() *harnessapi.TurnUsage {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.tokens.take()
}
