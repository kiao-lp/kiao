package access

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	coreconfig "kiao/worker/internal/core/config"
	"kiao/worker/internal/core/logging"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Identity is a redacted view of the caller for logging. It travels through the request
// context; a turn retains its initiating identity for callback attribution.
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

// RequiredRole grants the owner's Keycloak account access to the whole API.
const RequiredRole = "files_user"

type ctxKey int

const identityKey ctxKey = 0

// Authenticator validates Keycloak JWTs against a JWKS endpoint and requires files_user.
// In "debug" mode it permits all requests, decoding tokens without validation for trace visibility.
type Authenticator struct {
	mode      string // "prod" | "debug"
	issuer    string
	jwkSetURI string
	jwks      *jwksCache

	// turnTokens are the credentials this service issued to its own Claude turns, so that the MCP
	// servers the CLI spawns can call back in (see claude_mcp.go). Nil unless wired by main, which
	// is what keeps every deployment that stages no kiao-mcp bundle on the JWT path alone.
	turnTokens *TurnTokenRegistry
}

func NewAuthenticator(cfg *coreconfig.Config) *Authenticator {
	if cfg.AuthMode == "debug" {
		logging.LogAuth.Warn("security mode=debug — all requests permitted, JWTs decoded without validation")
		logging.LogAuth.Warn("do not run debug mode in production")
	} else {
		logging.LogAuth.Info("security mode=prod — strict OAuth2/JWT validation", "required_role", RequiredRole)
		logging.LogAuth.Info("issuer configured", "issuer_uri", orUnset(cfg.IssuerURI))
		logging.LogAuth.Info("jwks configured", "jwk_set_uri", orUnset(cfg.JwkSetURI))
	}
	return &Authenticator{
		mode:      cfg.AuthMode,
		issuer:    cfg.IssuerURI,
		jwkSetURI: cfg.JwkSetURI,
		jwks:      newJWKSCache(cfg.JwkSetURI),
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
		if !contains(roles, RequiredRole) {
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
