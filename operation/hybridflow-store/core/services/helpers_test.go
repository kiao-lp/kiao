package services_test

import (
	"strconv"
	"sync"
	"testing"
	"time"

	"kiao/hybridflow-store/adapters/memory"
	"kiao/hybridflow-store/core/services"
)

// ── The core, wired to nothing ────────────────────────────────────────────────
//
// These tests are `package services_test` rather than `package services`, and that is the
// architecture stated in a file header: the package under test imports no adapter — not one line —
// and the tests of it may, because a test is allowed to choose which end of a port it holds.
//
// What they hold is the in-memory store (adapters/memory). So every rule below is checked with no
// database anywhere near it, which is the whole claim core/ports makes.

type fixedClock struct{ at time.Time }

func (c fixedClock) Now() time.Time { return c.at }

// countingIDs mints readable ids, because a failure naming `id-3` is one a person can follow and a
// failure naming a uuid is one they have to grep for.
type countingIDs struct {
	mu sync.Mutex
	n  int
}

func (i *countingIDs) NewID() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.n++
	return "id-" + strconv.Itoa(i.n)
}

func newCore() (*services.Boards, *services.FlowNodes, *services.Agents, *memory.Store) {
	store := memory.New()
	clock := fixedClock{at: time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)}
	ids := &countingIDs{}
	return services.NewBoards(store, clock, ids), services.NewFlowNodes(store, store, store, store, store, clock, ids),
		services.NewAgents(store, clock, ids), store
}

var _ = testing.Short
