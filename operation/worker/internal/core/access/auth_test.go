package access

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	coreconfig "kiao/worker/internal/core/config"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testIssuer = "https://issuer.example/realms/kiao"

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

	auth := NewAuthenticator(&coreconfig.Config{
		AuthMode:  "prod",
		IssuerURI: testIssuer,
		JwkSetURI: jwks.URL,
	})
	return auth, key, kid
}

func mintToken(t *testing.T, key *rsa.PrivateKey, kid, issuer string, roles []string) string {
	t.Helper()
	return mintTokenWithExpiry(t, key, kid, issuer, roles, time.Now().Add(time.Hour))
}

func mintTokenWithExpiry(t *testing.T, key *rsa.PrivateKey, kid, issuer string, roles []string, expiry time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":                issuer,
		"sub":                "user-123",
		"preferred_username": "alice",
		"exp":                expiry.Unix(),
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

func TestAuthRequiresFilesUser(t *testing.T) {
	auth, key, kid := newTestAuth(t)
	cases := []struct {
		name  string
		roles []string
		want  int
	}{
		{"owner", []string{"files_user"}, http.StatusOK},
		{"owner with legacy role", []string{"files_user", "files_reader"}, http.StatusOK},
		{"no roles", nil, http.StatusForbidden},
		{"empty roles", []string{}, http.StatusForbidden},
		{"other role", []string{"some_other_role"}, http.StatusForbidden},
		{"similar role", []string{"files_user_other"}, http.StatusForbidden},
		{"legacy reader", []string{"files_reader"}, http.StatusForbidden},
		{"legacy reader with other role", []string{"files_reader", "some_other_role"}, http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			token := mintToken(t, key, kid, testIssuer, c.roles)
			for _, route := range []struct{ method, target string }{
				{http.MethodGet, "/getFile?path=units/note.md"},
				{http.MethodGet, "/list?path=units"},
				{http.MethodGet, "/listRecursive?path=units/abc&path=units/def"},
				{http.MethodGet, "/info?path=units/note.md"},
				{http.MethodGet, "/search?path=units&query=podcast"},
				{http.MethodGet, "/list"},
				{http.MethodGet, "/getFile?path=prive.txt"},
				{http.MethodGet, "/diskUsage"},
				{http.MethodGet, "/toolbox"},
				{http.MethodPost, "/upload?path=units/note.md"},
				{http.MethodDelete, "/delete?path=prive.txt"},
				{http.MethodGet, "/ws/hybridflow-runner"},
			} {
				req := httptest.NewRequest(route.method, route.target, nil)
				req.Header.Set("Authorization", "Bearer "+token)
				if code := statusFor(auth, req); code != c.want {
					t.Errorf("%s %s: status = %d, want %d", route.method, route.target, code, c.want)
				}
			}
		})
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

func TestAuthInvalidToken(t *testing.T) {
	auth, key, kid := newTestAuth(t)
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	hmac := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": testIssuer, "exp": time.Now().Add(time.Hour).Unix(),
		"realm_access": map[string]any{"roles": []string{"files_user"}},
	})
	hmac.Header["kid"] = kid
	hmacToken, err := hmac.SignedString([]byte("test-signing-key"))
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct{ name, token string }{
		{"malformed", "not-a-jwt"},
		{"wrong signature", mintToken(t, otherKey, kid, testIssuer, []string{"files_user"})},
		{"unknown key", mintToken(t, key, "unknown-kid", testIssuer, []string{"files_user"})},
		{"expired", mintTokenWithExpiry(t, key, kid, testIssuer, []string{"files_user"}, time.Now().Add(-time.Hour))},
		{"unsupported algorithm", hmacToken},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for _, transport := range []string{"header", "query"} {
				t.Run(transport, func(t *testing.T) {
					req := httptest.NewRequest(http.MethodGet, "/list?path=units", nil)
					if transport == "query" {
						query := req.URL.Query()
						query.Set("access_token", c.token)
						req.URL.RawQuery = query.Encode()
					} else {
						req.Header.Set("Authorization", "Bearer "+c.token)
					}
					if code := statusFor(auth, req); code != http.StatusUnauthorized {
						t.Errorf("invalid token: status = %d, want 401", code)
					}
				})
			}
		})
	}
}

func TestAuthDebugModePermitsAll(t *testing.T) {
	auth := NewAuthenticator(&coreconfig.Config{AuthMode: "debug"})
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
	auth := NewAuthenticator(&coreconfig.Config{AuthMode: "prod", IssuerURI: testIssuer, JwkSetURI: "https://jwks"})
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
