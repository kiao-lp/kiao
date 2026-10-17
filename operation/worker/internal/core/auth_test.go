package core

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testIssuer = "https://issuer.example/realms/kiao"

// testReaderRoutes stands in for the allowlist the program hands the authenticator. The real one
// lives beside the mux it mirrors, and server_test.go is what keeps the two in step; here only the
// shape matters — a route on the list and one that is not.
var testReaderRoutes = map[string]bool{
	"GET /getFile":       true,
	"GET /list":          true,
	"GET /listRecursive": true,
	"GET /info":          true,
	"GET /search":        true,
}

func newTestAuth(t *testing.T) (*Authenticator, *rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	kid := "test-kid"

	// JWKS endpoint exposing the public key.
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}) // 65537
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{
				{"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": n, "e": e},
			},
		})
	}))
	t.Cleanup(jwks.Close)

	auth := NewAuthenticator(&Config{
		AuthMode:  "prod",
		IssuerURI: testIssuer,
		JwkSetURI: jwks.URL,
	}, testReaderRoutes)
	return auth, key, kid
}

func mintToken(t *testing.T, key *rsa.PrivateKey, kid, issuer string, roles []string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":                issuer,
		"sub":                "user-123",
		"preferred_username": "alice",
		"exp":                time.Now().Add(time.Hour).Unix(),
		"realm_access":       map[string]any{"roles": roles},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

// newTestReaderAuth builds an authenticator whose read-only role is scoped to the given roots,
// sharing the JWKS server and key of newTestAuth so the same minting helper works for both.
func newTestReaderAuth(t *testing.T, roots ...string) (*Authenticator, *rsa.PrivateKey, string) {
	t.Helper()
	auth, key, kid := newTestAuth(t)
	auth.reader = newReaderScope(testReaderRoutes, roots)
	return auth, key, kid
}

func statusFor(auth *Authenticator, req *http.Request) int {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	rec := httptest.NewRecorder()
	auth.Middleware(next).ServeHTTP(rec, req)
	return rec.Code
}

func TestAuthValidToken(t *testing.T) {
	auth, key, kid := newTestAuth(t)
	token := mintToken(t, key, kid, testIssuer, []string{"files_user", "other"})

	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusOK {
		t.Errorf("valid token: status = %d, want 200", code)
	}

	// Same token via query parameter (used by downloads and the WebSocket).
	req2 := httptest.NewRequest(http.MethodGet, "/getFile?access_token="+token, nil)
	if code := statusFor(auth, req2); code != http.StatusOK {
		t.Errorf("query-param token: status = %d, want 200", code)
	}
}

func TestAuthNoToken(t *testing.T) {
	auth, _, _ := newTestAuth(t)
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	if code := statusFor(auth, req); code != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", code)
	}
}

func TestAuthMissingRole(t *testing.T) {
	auth, key, kid := newTestAuth(t)
	token := mintToken(t, key, kid, testIssuer, []string{"some_other_role"})
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusForbidden {
		t.Errorf("missing role: status = %d, want 403", code)
	}
}

func TestAuthWrongIssuer(t *testing.T) {
	auth, key, kid := newTestAuth(t)
	token := mintToken(t, key, kid, "https://evil.example/realms/x", []string{"files_user"})
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusUnauthorized {
		t.Errorf("wrong issuer: status = %d, want 401", code)
	}
}

func TestAuthDebugModePermitsAll(t *testing.T) {
	auth := NewAuthenticator(&Config{AuthMode: "debug"}, testReaderRoutes)
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	if code := statusFor(auth, req); code != http.StatusOK {
		t.Errorf("debug mode: status = %d, want 200", code)
	}
}

// TestAuthTurnToken covers the second credential this service accepts: the one it issued to a
// Claude turn so the MCP servers that turn spawns can call back in. It is checked in prod mode,
// where those servers have no other way in — there is no browser inside a spawned CLI to complete
// a Keycloak login with — and it must stop working the moment the turn ends.
func TestAuthTurnToken(t *testing.T) {
	auth, _, _ := newTestAuth(t)
	tokens := NewTurnTokenRegistry()
	auth.AcceptTurnTokens(tokens)

	token, err := tokens.Issue(Identity{User: "alex", Roles: "files_user"}, "conv-1/turn-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusOK {
		t.Errorf("turn token: status = %d, want 200", code)
	}

	// Revoked with the turn, and refused from that moment: this is the whole reason the credential
	// is minted per turn rather than configured once.
	tokens.Revoke(token)
	req = httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusUnauthorized {
		t.Errorf("revoked turn token: status = %d, want 401", code)
	}

	// A service that stages no kiao-mcp bundle wires no registry, so no turn token exists to be
	// honoured and the JWT check is the only way in.
	unwired, _, _ := newTestAuth(t)
	req = httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+turnTokenPrefix+"forged")
	if code := statusFor(unwired, req); code != http.StatusUnauthorized {
		t.Errorf("forged turn token on an unwired service: status = %d, want 401", code)
	}
}

// TestAuthTurnTokenIdentity checks that a turn's write is attributed to whoever asked for the turn
// and is distinguishable in the log from one the same person made in the file browser.
func TestAuthTurnTokenIdentity(t *testing.T) {
	auth := NewAuthenticator(&Config{AuthMode: "prod", IssuerURI: testIssuer, JwkSetURI: "https://jwks"}, testReaderRoutes)
	tokens := NewTurnTokenRegistry()
	auth.AcceptTurnTokens(tokens)
	token, _ := tokens.Issue(Identity{User: "alex", Roles: "files_user", Source: "SPRING_SEC"}, "conv-1/turn-1")

	var seen Identity
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = IdentityFromRequest(r) })
	req := httptest.NewRequest(http.MethodGet, "/list", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	auth.Middleware(next).ServeHTTP(httptest.NewRecorder(), req)

	if seen.User != "alex" || seen.Roles != "files_user" {
		t.Errorf("identity = %+v, want the user who started the turn", seen)
	}
	if seen.Source != "TURN_TOKEN" {
		t.Errorf("source = %q, want TURN_TOKEN", seen.Source)
	}
}

// ── the read-only role ────────────────────────────────────────────────────────

// A caller bearing files_reader alone reaches the five read routes, and only for paths under a
// configured reader root. Everything else — a route that changes the store, a route that is merely
// not on the list, a path outside the roots — is 403, which is what keeps a listening account out
// of the rest of the store.
func TestAuthReaderRoleScope(t *testing.T) {
	auth, key, kid := newTestReaderAuth(t, "units")
	token := mintToken(t, key, kid, testIssuer, []string{"files_reader"})

	cases := []struct {
		name   string
		method string
		target string
		want   int
	}{
		{"getFile in scope", http.MethodGet, "/getFile?path=units/abc/abc.mp3", http.StatusOK},
		{"list in scope", http.MethodGet, "/list?path=units", http.StatusOK},
		{"listRecursive in scope", http.MethodGet, "/listRecursive?path=units/abc&path=units/def", http.StatusOK},
		{"info in scope", http.MethodGet, "/info?path=units/abc/abc.mlunit.json", http.StatusOK},
		{"search in scope", http.MethodGet, "/search?path=units&query=podcast", http.StatusOK},

		{"path outside the roots", http.MethodGet, "/getFile?path=docs/secret.md", http.StatusForbidden},
		{"the store root itself", http.MethodGet, "/list?path=.", http.StatusForbidden},
		{"no path at all", http.MethodGet, "/list", http.StatusForbidden},
		{"one path of several outside", http.MethodGet, "/listRecursive?path=units/abc&path=docs", http.StatusForbidden},
		{"a sibling of a root", http.MethodGet, "/list?path=unitsold", http.StatusForbidden},

		{"a route that writes", http.MethodDelete, "/delete?path=units/abc/abc.mp3", http.StatusForbidden},
		{"a route that is not listed", http.MethodGet, "/diskUsage", http.StatusForbidden},
		{"a listed path under another method", http.MethodPost, "/list?path=units", http.StatusForbidden},
		{"the socket", http.MethodGet, "/ws/claude?path=units", http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.target, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			if code := statusFor(auth, req); code != c.want {
				t.Errorf("%s %s: status = %d, want %d", c.method, c.target, code, c.want)
			}
		})
	}
}

// Traversal buys a reader nothing: the requested path is normalised before it is matched against
// the roots, so a path that climbs out of a root is compared as where it actually lands — the same
// boundary ResolvePath enforces one layer down, applied one layer earlier.
func TestAuthReaderRoleRefusesTraversal(t *testing.T) {
	auth, key, kid := newTestReaderAuth(t, "units")
	token := mintToken(t, key, kid, testIssuer, []string{"files_reader"})

	for _, target := range []string{
		"/getFile?path=units/../escape.md",
		"/getFile?path=units/abc/../../../etc/passwd",
		"/list?path=../outside",
		"/info?path=/units/../docs",
		"/search?path=units/..&query=x",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		if code := statusFor(auth, req); code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403", target, code)
		}
	}

	// A leading slash is how Dashboard spells a root-relative path, and it must still resolve inside
	// the root rather than be read as an escape.
	req := httptest.NewRequest(http.MethodGet, "/getFile?path=/units/abc/abc.mp3", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(auth, req); code != http.StatusOK {
		t.Errorf("leading-slash path: status = %d, want 200", code)
	}
}

// files_user is unchanged by the split: it is unscoped, reaches everything, and is unaffected by
// whether the token also carries the read-only role.
func TestAuthFilesUserIsUnscoped(t *testing.T) {
	auth, key, kid := newTestReaderAuth(t, "units")

	for _, roles := range [][]string{{"files_user"}, {"files_user", "files_reader"}} {
		token := mintToken(t, key, kid, testIssuer, roles)
		for _, target := range []string{"/list", "/getFile?path=docs/secret.md", "/diskUsage"} {
			req := httptest.NewRequest(http.MethodGet, target, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			if code := statusFor(auth, req); code != http.StatusOK {
				t.Errorf("roles %v on %s: status = %d, want 200", roles, target, code)
			}
		}
		req := httptest.NewRequest(http.MethodDelete, "/delete?path=docs/secret.md", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		if code := statusFor(auth, req); code != http.StatusOK {
			t.Errorf("roles %v on DELETE /delete: status = %d, want 200", roles, code)
		}
	}
}

// The roots are configuration, so several of them work and an empty list closes the role rather
// than opening the store.
func TestAuthReaderRoots(t *testing.T) {
	several, key, kid := newTestReaderAuth(t, "units", "media/audio")
	token := mintToken(t, key, kid, testIssuer, []string{"files_reader"})
	for target, want := range map[string]int{
		"/list?path=units":              http.StatusOK,
		"/list?path=media/audio/en":     http.StatusOK,
		"/list?path=media":              http.StatusForbidden,
		"/list?path=media/audio/../key": http.StatusForbidden,
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		if code := statusFor(several, req); code != want {
			t.Errorf("%s: status = %d, want %d", target, code, want)
		}
	}

	none, key, kid := newTestReaderAuth(t)
	token = mintToken(t, key, kid, testIssuer, []string{"files_reader"})
	req := httptest.NewRequest(http.MethodGet, "/list?path=units", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(none, req); code != http.StatusForbidden {
		t.Errorf("no reader roots: status = %d, want 403", code)
	}

	// A root that escapes the store is dropped rather than honoured, so a request escaping the same
	// way cannot match it.
	escaping, key, kid := newTestReaderAuth(t, "../elsewhere")
	token = mintToken(t, key, kid, testIssuer, []string{"files_reader"})
	req = httptest.NewRequest(http.MethodGet, "/list?path=../elsewhere", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if code := statusFor(escaping, req); code != http.StatusForbidden {
		t.Errorf("escaping reader root: status = %d, want 403", code)
	}
}

// The default is the content a listening client needs and nothing else, and an explicitly empty
// value has to survive LoadConfig as the empty list that closes the role.
func TestReaderRootsFromEnvironment(t *testing.T) {
	t.Setenv("KIAO_WORKER_ROOT_PATH", t.TempDir())
	t.Setenv("KIAO_WORKER_READER_ROOTS", "units, media/audio ")
	if got := LoadConfig().ReaderRoots; len(got) != 2 || got[0] != "units" || got[1] != "media/audio" {
		t.Errorf("ReaderRoots = %v, want [units media/audio]", got)
	}

	t.Setenv("KIAO_WORKER_READER_ROOTS", "")
	if got := LoadConfig().ReaderRoots; len(got) != 0 {
		t.Errorf("ReaderRoots = %v, want none", got)
	}

	// Unset is the case a deployment that says nothing lands in: the content a listening client
	// needs, and nothing else.
	os.Unsetenv("KIAO_WORKER_READER_ROOTS") // t.Setenv above restores it afterwards
	if got := LoadConfig().ReaderRoots; len(got) != 1 || got[0] != "units" {
		t.Errorf("ReaderRoots = %v, want the default [units]", got)
	}
}
