package postgres

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/ports"
)

// The two small ports, over what this adapter already has.

// SystemClock is ports.Clock over the wall clock, in UTC. UTC because every timestamp this service
// stores is one, and a clock that handed out local times would be one conversion away from a board
// whose cards claim to have been created before they were.
type SystemClock struct{}

func (SystemClock) Now() time.Time { return time.Now().UTC() }

var _ ports.Clock = SystemClock{}

// IDs is ports.IDs: uuids, for boards, cards, agents and runners.
type IDs struct {
	pool *pgxpool.Pool
}

// NewIDs wires the minter. It takes the pool because uuids come from `gen_random_uuid()`: the
// database is never absent when an id is needed, and pgcrypto's generator is one dependency fewer
// than a uuid library for a service that would only use it here.
func NewIDs(pool *pgxpool.Pool) *IDs { return &IDs{pool: pool} }

var _ ports.IDs = (*IDs)(nil)

func (i *IDs) NewID() string {
	var id string
	if err := i.pool.QueryRow(context.Background(), `SELECT gen_random_uuid()::text`).Scan(&id); err == nil {
		return id
	}
	// A database that cannot answer is a request that is about to fail anyway; a locally minted
	// uuid keeps the failure at the write, where the error will say what happened, rather than
	// turning it into a panic in a getter.
	return localUUID()
}

func localUUID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}
