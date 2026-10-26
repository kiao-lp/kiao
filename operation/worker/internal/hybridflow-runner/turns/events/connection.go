package events

import (
	idgen "kiao/worker/internal/core/ids"
	"sync"
)

// Client serializes writes and retains subscriptions across turns.
type Client struct {
	conn FrameConnection
	Id   string
	user string

	writeMu sync.Mutex
	// Guarded by the shared engine mutex to keep both subscription maps consistent.
	subs map[string]struct{}

	closeOnce sync.Once
	// Closed by Close to stop the heartbeat immediately.
	Done chan struct{}
}

func NewClient(conn FrameConnection, user string) *Client {
	return &Client{
		conn: conn,
		Id:   idgen.RandID(),
		user: user,
		subs: map[string]struct{}{},
		Done: make(chan struct{}),
	}
}

func (c *Client) SendJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(v)
}

// Ping shares the JSON writer lock to avoid interleaved frames.
func (c *Client) Ping() error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Ping()
}

// Read, heartbeat and fan-out goroutines may all close the socket. Closing the connection
// unblocks the read loop, which eventually removes its subscriptions.
func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.Done)
		_ = c.conn.Close()
	})
}

// Conversation-list updates go to every open socket, including unsubscribed ones.
func (h *Subscriptions) AddConn(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.Conns[c.Id] = c
}

func (h *Subscriptions) DropConn(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.Conns, c.Id)
}

type FrameConnection interface {
	WriteJSON(any) error
	Ping() error
	Close() error
}
