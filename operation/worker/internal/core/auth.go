package core

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Identity is a redacted view of the caller for logging (kiao.worker.AuthIdentity). It
// travels with the request through the context, and a turn carries the one it was started for, so
// what a turn writes is attributed to whoever asked for it.
type Identity struct {
	User   string
	Roles  string
	Source string
	// Turn names the turn a TURN_TOKEN was minted for, as "<conversation>/<turn>". It is empty on
	// every other identity, and it is what makes a turn's MCP servers calling this service back
	// *readable* in the access log: the traffic is already marked TURN_TOKEN, and this says which
	// turn's tools made it — so a turn's trace and the requests its tools made join on one key.
	Turn string
}

// AnonymousIdentity is what a request carrying no credential is attributed to.
var AnonymousIdentity = Identity{User: "anonymous", Roles: "-", Source: "NONE"}

// The two realm roles this service knows. RequiredRole grants the whole surface, unscoped, and is
// what every editing client holds. ReaderRole grants the read-only routes in readerRoutes, and only
// under the configured reader roots — it is what a listening client is given, so an account made to
// download audio cannot see, let alone change, the rest of the store.
const (
	RequiredRole = "files_user"
	ReaderRole   = "files_reader"
)

type ctxKey int

const identityKey ctxKey = 0

// Authenticator validates Keycloak JWTs against a JWKS endpoint and enforces the realm roles.
// In "debug" mode it permits all requests, decoding tokens without validation for trace visibility.
type Authenticator struct {
	mode      string // "prod" | "debug"
	issuer    string
	jwkSetURI string
	jwks      *jwksCache

	// reader is what a caller who holds only ReaderRole is allowed to do.
	reader readerScope

	// turnTokens are the credentials this service issued to its own Claude turns, so that the MCP
	// servers the CLI spawns can call back in (see claude_mcp.go). Nil unless wired by main, which
	// is what keeps every deployment that stages no kiao-mcp bundle on the JWT path alone.
	turnTokens *TurnTokenRegistry
}

func NewAuthenticator(cfg *Config, readerRoutes map[string]bool) *Authenticator {
	if cfg.AuthMode == "debug" {
		LogAuth.Warn("security mode=debug — all requests permitted, JWTs decoded without validation")
		LogAuth.Warn("do not run debug mode in production")
	} else {
		LogAuth.Info("security mode=prod — strict OAuth2/JWT validation", "required_role", RequiredRole)
		LogAuth.Info("read-only role configured", "role", ReaderRole, "reader_roots", orUnset(strings.Join(cfg.ReaderRoots, ",")))
		LogAuth.Info("issuer configured", "issuer_uri", orUnset(cfg.IssuerURI))
		LogAuth.Info("jwks configured", "jwk_set_uri", orUnset(cfg.JwkSetURI))
	}
	return &Authenticator{
		mode:      cfg.AuthMode,
		issuer:    cfg.IssuerURI,
		jwkSetURI: cfg.JwkSetURI,
		jwks:      newJWKSCache(cfg.JwkSetURI),
		reader:    newReaderScope(readerRoutes, cfg.ReaderRoots),
	}
}

// AcceptTurnTokens lets this authenticator honour the per-turn credentials that registry issues.
// Wired once, from main: nothing else in the service may hand out a way past the JWT check, and a
// registry that is never wired is a feature that is off rather than one that half-works.
func (a *Authenticator) AcceptTurnTokens(r *TurnTokenRegistry) {
	a.turnTokens = r
}

func orUnset(s string) string {
	if strings.TrimSpace(s) == "" {
		return "<unset>"
	}
	return s
}

// Middleware enforces authentication/authorization and stashes the caller identity in the
// request context for downstream logging.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)

		// Checked before either mode. A turn token is not a JWT, so the debug branch would log it as
		// an unparseable one and lose the very thing it carries: which user this turn is acting for.
		// In prod it is the only credential the MCP servers have — they run inside a spawned CLI,
		// with no browser to complete a Keycloak login in.
		if id, ok := a.turnTokens.Lookup(token); ok {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, id)))
			return
		}

		if a.mode == "debug" {
			id := decodeBearer(token)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, id)))
			return
		}

		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		id, roles, err := a.validate(token)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if !a.authorize(roles, r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey, id)))
	})
}

// validate verifies signature, issuer and expiry, returning the identity and realm roles.
func (a *Authenticator) validate(raw string) (Identity, []string, error) {
	parsed, err := jwt.Parse(raw, a.jwks.keyfunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(a.issuer),
	)
	if err != nil || !parsed.Valid {
		return Identity{}, nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return Identity{}, nil, fmt.Errorf("unexpected claims type")
	}
	user := stringClaim(claims, "preferred_username")
	if user == "" {
		user = stringClaim(claims, "sub")
	}
	roles := realmRoles(claims)
	return Identity{User: user, Roles: joinRoles(roles), Source: "SPRING_SEC"}, roles, nil
}

func extractToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if len(header) >= 7 && strings.EqualFold(header[:7], "Bearer ") {
		return strings.TrimSpace(header[7:])
	}
	if qp := r.URL.Query().Get("access_token"); strings.TrimSpace(qp) != "" {
		return qp
	}
	return ""
}

// decodeBearer parses a token without verifying its signature, for trace/debug display only.
func decodeBearer(token string) Identity {
	if strings.TrimSpace(token) == "" {
		return AnonymousIdentity
	}
	parser := jwt.NewParser()
	parsed, _, err := parser.ParseUnverified(token, jwt.MapClaims{})
	if err != nil {
		return Identity{User: "<unparseable-token>", Roles: "-", Source: "JWT_PARSE_FAILED"}
	}
	claims, _ := parsed.Claims.(jwt.MapClaims)
	user := stringClaim(claims, "preferred_username")
	if user == "" {
		user = stringClaim(claims, "sub")
	}
	if user == "" {
		user = "<no-sub>"
	}
	roles := joinRoles(realmRoles(claims))
	if roles == "" {
		roles = "-"
	}
	return Identity{User: user, Roles: roles, Source: "JWT_DECODED_NO_VALIDATE"}
}

func IdentityFromRequest(r *http.Request) Identity {
	if id, ok := r.Context().Value(identityKey).(Identity); ok {
		return id
	}
	return decodeBearer(extractToken(r))
}

func stringClaim(claims jwt.MapClaims, key string) string {
	if v, ok := claims[key].(string); ok {
		return v
	}
	return ""
}

func realmRoles(claims jwt.MapClaims) []string {
	ra, ok := claims["realm_access"].(map[string]any)
	if !ok {
		return nil
	}
	rs, ok := ra["roles"].([]any)
	if !ok {
		return nil
	}
	roles := make([]string, 0, len(rs))
	for _, r := range rs {
		if s, ok := r.(string); ok {
			roles = append(roles, s)
		}
	}
	return roles
}

func joinRoles(roles []string) string {
	return strings.Join(roles, ",")
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// authorize decides what a validated caller's realm roles allow for this request. RequiredRole is
// unscoped and reaches everything. ReaderRole reaches the read-only surface and nothing else, and a
// token carrying neither role gets nowhere — holding both is simply the first case.
func (a *Authenticator) authorize(roles []string, r *http.Request) bool {
	switch {
	case contains(roles, RequiredRole):
		return true
	case contains(roles, ReaderRole):
		return a.reader.permits(r)
	default:
		return false
	}
}

// ── the read-only role ────────────────────────────────────────────────────────

// readerScope is what ReaderRole amounts to: an allowlist of routes and a set of store-root-relative
// prefixes the paths those routes are asked about must sit under. Both halves are data — the routes
// come from the program, beside the mux they mirror, the roots from KIAO_WORKER_READER_ROOTS —
// so the decision is one lookup here rather than a comparison repeated in every handler.
type readerScope struct {
	routes map[string]bool
	roots  []string
}

// newReaderScope normalises the configured prefixes to the plain root-relative form path
// comparisons need. A prefix that escapes the root is dropped: it can only ever have named
// something outside the store, and keeping it would let a request that escapes the root the same
// way match it before Storage got the chance to refuse it.
func newReaderScope(routes map[string]bool, roots []string) readerScope {
	scope := readerScope{routes: routes}
	for _, root := range roots {
		if r := NormaliseVirtual(root); r != "" && r != ".." && !strings.HasPrefix(r, "../") {
			scope.roots = append(scope.roots, r)
		}
	}
	return scope
}

// permits answers whether a caller holding only ReaderRole may make this request: the route is on
// the allowlist, the request names at least one path, and every path it names is in scope. Requiring
// a path is what keeps the store root itself out of reach — /list with no path is a listing of
// everything, which is precisely what the roots exist to prevent.
func (s readerScope) permits(r *http.Request) bool {
	if !s.routes[r.Method+" "+r.URL.Path] {
		return false
	}
	paths := r.URL.Query()["path"]
	if len(paths) == 0 {
		return false
	}
	for _, p := range paths {
		if !s.covers(p) {
			return false
		}
	}
	return true
}

// covers answers whether one requested path sits under a reader root. The path is normalised first,
// so "units/../secrets" is compared as "secrets" and traversal buys nothing: a path that climbs out
// of the root keeps its leading ".." and matches no root.
func (s readerScope) covers(p string) bool {
	virtual := NormaliseVirtual(p)
	if virtual == "" {
		return false
	}
	for _, root := range s.roots {
		if virtual == root || strings.HasPrefix(virtual, root+"/") {
			return true
		}
	}
	return false
}

// ── JWKS cache ────────────────────────────────────────────────────────────────

type jwksCache struct {
	uri        string
	mu         sync.RWMutex
	keys       map[string]*rsa.PublicKey
	lastFetch  time.Time
	httpClient *http.Client
}

func newJWKSCache(uri string) *jwksCache {
	return &jwksCache{
		uri:        uri,
		keys:       map[string]*rsa.PublicKey{},
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// keyfunc resolves the signing key for a token by its "kid" header, refreshing the JWKS on a miss.
func (c *jwksCache) keyfunc(token *jwt.Token) (any, error) {
	kid, _ := token.Header["kid"].(string)
	if key := c.lookup(kid); key != nil {
		return key, nil
	}
	if err := c.refresh(); err != nil {
		return nil, err
	}
	if key := c.lookup(kid); key != nil {
		return key, nil
	}
	return nil, fmt.Errorf("no signing key for kid %q", kid)
}

func (c *jwksCache) lookup(kid string) *rsa.PublicKey {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.keys[kid]
}

func (c *jwksCache) refresh() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Throttle refreshes triggered by unknown kids to at most one per 10s.
	if time.Since(c.lastFetch) < 10*time.Second && len(c.keys) > 0 {
		return nil
	}
	resp, err := c.httpClient.Get(c.uri)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}
	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	c.keys = keys
	c.lastFetch = time.Now()
	return nil
}

func rsaPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	if !e.IsInt64() || e.Int64() > int64(^uint32(0)) {
		return nil, fmt.Errorf("invalid RSA exponent")
	}
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}
