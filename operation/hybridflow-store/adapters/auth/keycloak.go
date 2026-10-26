// Package auth is the authentication adapter: Keycloak JWTs validated against the realm's JWKS,
// and the caller's identity put where the rest of the request can read it.
//
// ── Compatible with worker, and what that means exactly ────────────────
//
// It means the **same tokens**, not a similar scheme. A browser holding a Dashboard session, an MCP
// server holding a service account, a `curl` with a copied bearer: whatever reaches worker
// reaches this service, with no second login and no second client registration. Concretely:
//
//   - the same realm, read from the same two environment variables — `KIAO_KEYCLOAK_ISSUER_URI`
//     and `KIAO_KEYCLOAK_JWK_SET_URI`, under those names (see lib/config);
//   - the same algorithm and the same checks — RS256, the issuer, the expiry;
//   - the same realm role, `files_user`, and the same reading of `realm_access.roles`;
//   - the same two places a token may be — the `Authorization: Bearer` header, and an
//     `access_token` query parameter, which is what a client that cannot set a header uses;
//   - the same two modes, `prod` and `debug`, and the same loud warning on the second.
//
// The one thing it does **not** carry over is the `files_reader` role. That role exists to let
// read-only clients download files out of the store, and there is nothing here for them to read:
// a caller bearing it and not `files_user` is refused, rather than given a narrower view of a
// board.
// Boards are not published to listeners, so a read-only scope would be a surface with no user.
//
// It is a copy rather than a shared library on purpose. The two services are deployed together and
// the realm is one, so the values must match — but a shared Go module between them would make the
// core of one service a dependency of the other's socle, and an adapter is exactly the place a
// protocol this service does not own is allowed to be restated. The list above is the contract; if
// it ever needs to move, it moves in both files and the pair fails loudly rather than quietly
// disagreeing about who a caller is.
package auth

import (
	"context"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"kiao/hybridflow-store/lib/logging"
)

// Role is the realm role that reaches this service. Same word worker uses for the same
// people: a board is edited by whoever edits the store.
const Role = "files_user"

// ActorHeader lets a caller bearing the **service token** say whose work this is.
//
// A run lasts hours and a user's token lasts minutes, so worker cannot carry the credential
// of the person who clicked Play; it carries one of its own. Without this header every card a run
// moved would be attributed to the service, and a board would stop being able to say whose run
// touched it — which is most of what the change log is for.
//
// **Only the service token may use it.** A caller bearing a JWT is who its token says it is, and a
// header that could override that would be a way to write under somebody else's name. So the right
// to speak for a user is the service token's alone, which makes it one line to audit rather than a
// property of the whole surface.
const ActorHeader = "X-Kiao-Actor"

// serviceTokenSource marks an identity that arrived on the service token rather than on a JWT.
const serviceTokenSource = "SERVICE_TOKEN"

// ServiceUser is who a service-token caller is when it names nobody.
const ServiceUser = "worker"

// Identity is a redacted view of the caller, for the audit line and for the change log. It travels
// with the request in its context, and it is what every write records as its actor — so a card that
// moved says who moved it.
type Identity struct {
	User   string
	Roles  string
	Source string
}

// Anonymous is what a request carrying no credential is attributed to.
var Anonymous = Identity{User: "anonymous", Roles: "-", Source: "NONE"}

// Actor is the identity as the change log records it: the user name alone. Short on purpose — it is
// read in a list of changes, not in a security review, and the roles a token carried at the moment
// of a write are not what a reader of the board is asking.
func (i Identity) Actor() string {
	if i.User == "" {
		return "anonymous"
	}
	return i.User
}

type ctxKey int

const identityKey ctxKey = 0

// Authenticator validates tokens and enforces the role.
type Authenticator struct {
	mode   string
	issuer string
	jwks   *jwksCache
	// serviceToken is the credential the other services of the deployment present, or empty where
	// none is configured — in which case there is no second way in at all, which is the right
	// default for a surface that would otherwise accept a shared secret nobody chose.
	serviceToken string
}

// Options is what the adapter is built with.
type Options struct {
	// ServiceToken is the bearer the deployment's own services present. Empty switches the second
	// credential path off entirely.
	ServiceToken string

	// Mode is "prod" or "debug". In debug every request is permitted and tokens are decoded without
	// being validated, so a trace line still names the caller — which is what makes a throwaway
	// stack usable without a Keycloak beside it.
	Mode      string
	IssuerURI string
	JwkSetURI string
}

// New builds the authenticator and says out loud which mode it is in. The warning is deliberate and
// is worker's: a service permitting every request is a thing somebody must be able to notice
// in a log they were reading for another reason.
func New(opts Options) *Authenticator {
	if opts.Mode == "debug" {
		logging.Auth.Warn("security mode=debug — all requests permitted, JWTs decoded without validation")
		logging.Auth.Warn("do not run debug mode in production")
	} else {
		logging.Auth.Info("security mode=prod — strict OAuth2/JWT validation", "required_role", Role)
		logging.Auth.Info("realm configured", "issuer_uri", opts.IssuerURI, "jwk_set_uri", opts.JwkSetURI)
	}
	if opts.ServiceToken != "" {
		logging.Auth.Info("a service token is accepted beside the realm's tokens",
			"actor_header", ActorHeader, "default_actor", ServiceUser)
	}
	return &Authenticator{
		mode:         opts.Mode,
		issuer:       opts.IssuerURI,
		jwks:         newJWKSCache(opts.JwkSetURI),
		serviceToken: opts.ServiceToken,
	}
}

// Middleware enforces authentication and puts the identity in the request context.
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)

		// Checked before either mode. The service token is not a JWT, so the debug branch would log
		// it as an unparseable one and lose the very thing it carries: which user this run is acting
		// for. In prod it is the only credential a run has — a play outlives the request that
		// started it, and there is no browser to complete a login in.
		if identity, ok := a.serviceIdentity(r, token); ok {
			next.ServeHTTP(w, r.WithContext(With(r.Context(), identity)))
			return
		}

		if a.mode == "debug" {
			next.ServeHTTP(w, r.WithContext(With(r.Context(), decodeBearer(token))))
			return
		}
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		identity, roles, err := a.validate(token)
		if err != nil {
			logging.Ctx(r.Context()).Warn("token refused", "component", "auth", "error", err)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if !contains(roles, Role) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(With(r.Context(), identity)))
	})
}

// serviceIdentity recognises the deployment's own services, and reads the actor they name.
//
// Compared in constant time, because the token is a shared secret and the comparison is the whole
// of the check: a timing signal here is one a caller can sample as often as it likes.
func (a *Authenticator) serviceIdentity(r *http.Request, token string) (Identity, bool) {
	if a.serviceToken == "" || token == "" {
		return Identity{}, false
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(a.serviceToken)) != 1 {
		return Identity{}, false
	}
	user := strings.TrimSpace(r.Header.Get(ActorHeader))
	if user == "" {
		user = ServiceUser
	}
	return Identity{User: user, Roles: Role, Source: serviceTokenSource}, true
}

// validate verifies signature, issuer and expiry, and returns the identity and the realm roles.
func (a *Authenticator) validate(raw string) (Identity, []string, error) {
	parsed, err := jwt.Parse(raw, a.jwks.keyfunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(a.issuer))
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
	return Identity{User: user, Roles: strings.Join(roles, ","), Source: "JWT"}, roles, nil
}

// With puts an identity in a context.
func With(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, identityKey, identity)
}

// From reads the identity the middleware put in the context.
func From(ctx context.Context) Identity {
	if identity, ok := ctx.Value(identityKey).(Identity); ok {
		return identity
	}
	return Anonymous
}

func extractToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if len(header) >= 7 && strings.EqualFold(header[:7], "Bearer ") {
		return strings.TrimSpace(header[7:])
	}
	if qp := strings.TrimSpace(r.URL.Query().Get("access_token")); qp != "" {
		return qp
	}
	return ""
}

// decodeBearer parses a token without verifying it, for debug mode and the trace line only.
func decodeBearer(token string) Identity {
	if strings.TrimSpace(token) == "" {
		return Anonymous
	}
	parsed, _, err := jwt.NewParser().ParseUnverified(token, jwt.MapClaims{})
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
	roles := strings.Join(realmRoles(claims), ",")
	if roles == "" {
		roles = "-"
	}
	return Identity{User: user, Roles: roles, Source: "JWT_DECODED_NO_VALIDATE"}
}

func stringClaim(claims jwt.MapClaims, key string) string {
	if value, ok := claims[key].(string); ok {
		return value
	}
	return ""
}

func realmRoles(claims jwt.MapClaims) []string {
	access, ok := claims["realm_access"].(map[string]any)
	if !ok {
		return nil
	}
	raw, ok := access["roles"].([]any)
	if !ok {
		return nil
	}
	roles := make([]string, 0, len(raw))
	for _, entry := range raw {
		if role, ok := entry.(string); ok {
			roles = append(roles, role)
		}
	}
	return roles
}

func contains(list []string, value string) bool {
	for _, entry := range list {
		if entry == value {
			return true
		}
	}
	return false
}

// ── the realm's signing keys ──────────────────────────────────────────────────

// jwksCache holds the realm's public keys and refetches them when a token names one it has not
// seen. A key rotation is then one slow request rather than every request failing until a restart —
// and refetching only on an unknown `kid` is what keeps a flood of bad tokens from becoming a flood
// of requests at the identity provider.
type jwksCache struct {
	uri string

	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

// jwksMinRefetch bounds how often an unknown key id may send us back to the realm.
const jwksMinRefetch = time.Minute

func newJWKSCache(uri string) *jwksCache {
	return &jwksCache{uri: uri, keys: map[string]*rsa.PublicKey{}}
}

func (c *jwksCache) keyfunc(token *jwt.Token) (any, error) {
	kid, _ := token.Header["kid"].(string)
	if kid == "" {
		return nil, fmt.Errorf("the token names no key id")
	}
	c.mu.RLock()
	key, held := c.keys[kid]
	stale := time.Since(c.fetchedAt) > jwksMinRefetch
	c.mu.RUnlock()
	if held {
		return key, nil
	}
	if !stale {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	if err := c.fetch(); err != nil {
		return nil, err
	}
	c.mu.RLock()
	key, held = c.keys[kid]
	c.mu.RUnlock()
	if !held {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	return key, nil
}

type jwksDocument struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func (c *jwksCache) fetch() error {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(c.uri)
	if err != nil {
		return fmt.Errorf("the realm's keys could not be fetched: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("the realm's keys answered %d", resp.StatusCode)
	}
	var document jwksDocument
	if err := json.NewDecoder(resp.Body).Decode(&document); err != nil {
		return fmt.Errorf("the realm's keys could not be read: %w", err)
	}
	keys := map[string]*rsa.PublicKey{}
	for _, entry := range document.Keys {
		if entry.Kty != "RSA" || entry.Kid == "" {
			continue
		}
		modulus, err := base64.RawURLEncoding.DecodeString(entry.N)
		if err != nil {
			continue
		}
		exponent, err := base64.RawURLEncoding.DecodeString(entry.E)
		if err != nil {
			continue
		}
		keys[entry.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(modulus),
			E: int(new(big.Int).SetBytes(exponent).Int64()),
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("the realm published no usable RSA key")
	}
	c.mu.Lock()
	c.keys = keys
	c.fetchedAt = time.Now()
	c.mu.Unlock()
	logging.Auth.Info("realm keys loaded", "count", len(keys))
	return nil
}
