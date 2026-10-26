package access

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"time"
)

// turnTokenTTL limits unreclaimed credentials; finishTurn revokes settled turns.
// The in-memory registry is also cleared on restart.
const turnTokenTTL = 8 * time.Hour

// turnTokenPrefix aids recognition; lookup matches the whole token.
const turnTokenPrefix = "kiao-turn."

type turnToken struct {
	identity Identity
	expires  time.Time
}

// TurnTokenRegistry authenticates spawned turns without a browser login. Tokens
// retain the authenticated caller's identity, avoiding shared service-account
// credentials or caller JWTs that could expire mid-turn.
type TurnTokenRegistry struct {
	mu     sync.Mutex
	tokens map[string]turnToken
}

func NewTurnTokenRegistry() *TurnTokenRegistry {
	return &TurnTokenRegistry{tokens: map[string]turnToken{}}
}

// Issue creates a whole-store bearer credential with 256 bits of crypto/rand
// entropy, bound to the authenticated WebSocket caller. turn must identify the
// owning turn as "<conversation>/<turn>" for access-log attribution.
func (r *TurnTokenRegistry) Issue(id Identity, turn string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("cannot generate a turn token: %w", err)
	}
	token := turnTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)

	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	// Prune on issue: only issuance grows the map.
	for existing, entry := range r.tokens {
		if now.After(entry.expires) {
			delete(r.tokens, existing)
		}
	}
	// Preserve caller identity and roles; distinguish turn writes in the audit log.
	id.Source = "TURN_TOKEN"
	id.Turn = turn
	r.tokens[token] = turnToken{identity: id, expires: now.Add(turnTokenTTL)}
	return token, nil
}

// Lookup returns the token's identity. A nil registry accepts no turn tokens,
// allowing the caller to fall through to JWT authentication.
func (r *TurnTokenRegistry) Lookup(token string) (Identity, bool) {
	if r == nil || !strings.HasPrefix(token, turnTokenPrefix) {
		return Identity{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.tokens[token]
	if !ok {
		return Identity{}, false
	}
	if time.Now().After(entry.expires) {
		delete(r.tokens, token)
		return Identity{}, false
	}
	return entry.identity, true
}

// Revoke is called by finishTurn for failed, stopped and completed turns.
func (r *TurnTokenRegistry) Revoke(token string) {
	if r == nil || token == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tokens, token)
}

// Count reports how many tokens are live, for tests.
func (r *TurnTokenRegistry) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.tokens)
}
