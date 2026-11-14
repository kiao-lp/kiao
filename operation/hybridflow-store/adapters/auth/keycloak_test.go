package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestKeycloakAuthorization(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const issuer = "https://issuer.example/realms/kiao"
	const kid = "test-kid"
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
		}}})
	}))
	t.Cleanup(jwks.Close)
	auth := New(Options{Mode: "prod", IssuerURI: issuer, JwkSetURI: jwks.URL, ServiceToken: "test-service-token"})
	sign := func(roles []string, iss string, expiry time.Time, signingKey *rsa.PrivateKey, keyID string) string {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": iss, "sub": "test-owner", "exp": expiry.Unix(),
			"realm_access": map[string]any{"roles": roles},
		})
		token.Header["kid"] = keyID
		signed, err := token.SignedString(signingKey)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	expiry := time.Now().Add(time.Hour)
	owner := []string{"files_user"}
	cases := []struct {
		name, token string
		want        int
	}{
		{"owner", sign(owner, issuer, expiry, key, kid), http.StatusOK},
		{"owner and legacy reader", sign([]string{"files_user", "files_reader"}, issuer, expiry, key, kid), http.StatusOK},
		{"no roles", sign(nil, issuer, expiry, key, kid), http.StatusForbidden},
		{"other role", sign([]string{"other"}, issuer, expiry, key, kid), http.StatusForbidden},
		{"similar role", sign([]string{"files_user_other"}, issuer, expiry, key, kid), http.StatusForbidden},
		{"legacy reader", sign([]string{"files_reader"}, issuer, expiry, key, kid), http.StatusForbidden},
		{"expired", sign(owner, issuer, time.Now().Add(-time.Hour), key, kid), http.StatusUnauthorized},
		{"wrong issuer", sign(owner, "https://other.example/realms/kiao", expiry, key, kid), http.StatusUnauthorized},
		{"wrong signature", sign(owner, issuer, expiry, otherKey, kid), http.StatusUnauthorized},
		{"unknown key", sign(owner, issuer, expiry, key, "unknown"), http.StatusUnauthorized},
		{"missing", "", http.StatusUnauthorized},
		{"malformed", "not-a-jwt", http.StatusUnauthorized},
		{"wrong service token", "test-service-token-wrong", http.StatusUnauthorized},
		{"service", "test-service-token", http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for _, transport := range []string{"header", "query"} {
				for _, method := range []string{http.MethodGet, http.MethodPost} {
					req := httptest.NewRequest(method, "/boards", nil)
					if transport == "header" && c.token != "" {
						req.Header.Set("Authorization", "Bearer "+c.token)
					} else if c.token != "" {
						query := req.URL.Query()
						query.Set("access_token", c.token)
						req.URL.RawQuery = query.Encode()
					}
					req.Header.Set(ActorHeader, "test-agent")
					called := false
					handler := auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						called = true
						id := From(r.Context())
						wantUser, wantSource := "test-owner", "JWT"
						if c.name == "service" {
							wantUser, wantSource = "test-agent", serviceTokenSource
						}
						if id.User != wantUser || id.Source != wantSource {
							t.Errorf("identity = %+v; want user %s, source %s", id, wantUser, wantSource)
						}
						w.WriteHeader(http.StatusOK)
					}))
					rec := httptest.NewRecorder()
					handler.ServeHTTP(rec, req)
					if rec.Code != c.want || called != (c.want == http.StatusOK) {
						t.Errorf("%s %s: status = %d, handler called = %v; want %d", transport, method, rec.Code, called, c.want)
					}
				}
			}
		})
	}
}
