package core

import (
	"strings"
	"testing"
	"time"
)

// TestTurnTokenLifecycle pins what makes this credential safe to hand a spawned process: it stands
// for the caller who asked for the turn, it is recognisable as a turn token rather than a JWT, and
// it stops working the moment the turn ends.
func TestTurnTokenLifecycle(t *testing.T) {
	r := NewTurnTokenRegistry()
	caller := Identity{User: "alex", Roles: "files_user", Source: "SPRING_SEC"}

	token, err := r.Issue(caller, "conv-1/turn-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if !strings.HasPrefix(token, turnTokenPrefix) {
		t.Errorf("token = %q, want the %q prefix so it is never mistaken for a JWT", token, turnTokenPrefix)
	}

	id, ok := r.Lookup(token)
	if !ok {
		t.Fatalf("a freshly issued token must be accepted")
	}
	if id.User != "alex" || id.Roles != "files_user" {
		t.Errorf("identity = %+v, want the caller's user and roles", id)
	}
	// The write has to be distinguishable in the log from one the user made in the file browser.
	if id.Source != "TURN_TOKEN" {
		t.Errorf("source = %q, want TURN_TOKEN", id.Source)
	}
	// And which turn made it: the access log is where a turn's MCP servers calling this service
	// back is written down, and "some turn" cannot be joined to the turn's own trace.
	if id.Turn != "conv-1/turn-1" {
		t.Errorf("turn = %q, want the turn the token was minted for", id.Turn)
	}

	r.Revoke(token)
	if _, ok := r.Lookup(token); ok {
		t.Errorf("a revoked token must be refused — this is what bounds it to its turn")
	}
	if r.Count() != 0 {
		t.Errorf("revoke left %d token(s) behind", r.Count())
	}
}

// TestTurnTokenRejections covers everything that is not a live token of this registry's own.
func TestTurnTokenRejections(t *testing.T) {
	r := NewTurnTokenRegistry()

	if _, ok := r.Lookup(""); ok {
		t.Errorf("the empty token must be refused")
	}
	if _, ok := r.Lookup("eyJhbGciOiJSUzI1NiJ9.e30.sig"); ok {
		t.Errorf("a JWT must not be resolved as a turn token")
	}
	if _, ok := r.Lookup(turnTokenPrefix + "not-one-we-issued"); ok {
		t.Errorf("a well-shaped token this registry never issued must be refused")
	}

	// Nil-safe: a service that stages no bundle wires no registry, and every request has to fall
	// through to the JWT check rather than panic.
	var absent *TurnTokenRegistry
	if _, ok := absent.Lookup(turnTokenPrefix + "anything"); ok {
		t.Errorf("a service with no registry must accept no turn token")
	}
	absent.Revoke("x") // must not panic

	// Two turns never share a credential.
	a, _ := r.Issue(Identity{User: "one"}, "conv-1/turn-1")
	b, _ := r.Issue(Identity{User: "two"}, "conv-1/turn-2")
	if a == b {
		t.Fatalf("two turns were issued the same token")
	}
	r.Revoke(a)
	if _, ok := r.Lookup(b); !ok {
		t.Errorf("revoking one turn's token must not touch another's")
	}
}

// TestTurnTokenExpiry checks the backstop for a turn that never settles inside this process.
func TestTurnTokenExpiry(t *testing.T) {
	r := NewTurnTokenRegistry()
	token, err := r.Issue(Identity{User: "alex"}, "conv-1/turn-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	r.mu.Lock()
	entry := r.tokens[token]
	entry.expires = time.Now().Add(-time.Second)
	r.tokens[token] = entry
	r.mu.Unlock()

	if _, ok := r.Lookup(token); ok {
		t.Errorf("a lapsed token must be refused")
	}
	if r.Count() != 0 {
		t.Errorf("a lapsed token must be dropped when it is looked up, got %d left", r.Count())
	}
}
