package app

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"kiao/worker/internal/core/access"
	coreconfig "kiao/worker/internal/core/config"
)

func TestFileAccessRequiresOwnerRole(t *testing.T) {
	s, root := newTestServer(t)
	const content = "contenu reserve au proprietaire\n"
	mustWriteBytes(t, filepath.Join(root, "prive.txt"), []byte(content))
	if err := os.MkdirAll(filepath.Join(root, "units"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../prive.txt", filepath.Join(root, "units", "lien.txt")); err != nil {
		t.Fatal(err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const issuer = "https://issuer.example/realms/kiao"
	const kid = "test-kid"
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256",
				"n": base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
			}},
		})
	}))
	t.Cleanup(jwks.Close)
	s.auth = access.NewAuthenticator(&coreconfig.Config{
		AuthMode: "prod", IssuerURI: issuer, JwkSetURI: jwks.URL,
	})

	sign := func(roles []string, expiry time.Time) string {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": issuer, "sub": "test-user", "exp": expiry.Unix(),
			"realm_access": map[string]any{"roles": roles},
		})
		token.Header["kid"] = kid
		signed, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	expiry := time.Now().Add(time.Hour)
	cases := []struct {
		name, token string
		want        int
	}{
		{"owner", sign([]string{"files_user"}, expiry), http.StatusOK},
		{"owner with legacy role", sign([]string{"files_user", "files_reader"}, expiry), http.StatusOK},
		{"no roles", sign([]string{}, expiry), http.StatusForbidden},
		{"other role", sign([]string{"other"}, expiry), http.StatusForbidden},
		{"legacy reader", sign([]string{"files_reader"}, expiry), http.StatusForbidden},
		{"legacy reader with other role", sign([]string{"files_reader", "other"}, expiry), http.StatusForbidden},
		{"anonymous", "", http.StatusUnauthorized},
		{"malformed", "not-a-jwt", http.StatusUnauthorized},
		{"expired owner", sign([]string{"files_user"}, time.Now().Add(-time.Hour)), http.StatusUnauthorized},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			authorize := func(req *http.Request, transport string) {
				if c.token == "" {
					return
				}
				if transport == "query" {
					query := req.URL.Query()
					query.Set("access_token", c.token)
					req.URL.RawQuery = query.Encode()
				} else {
					req.Header.Set("Authorization", "Bearer "+c.token)
				}
			}
			for _, path := range []string{"prive.txt", "units/lien.txt"} {
				for _, transport := range []string{"header", "query"} {
					t.Run(path+"/"+transport, func(t *testing.T) {
						query := url.Values{"path": {path}}
						req := httptest.NewRequest(http.MethodGet, "/getFile?"+query.Encode(), nil)
						authorize(req, transport)
						rec := do(s, req)
						if rec.Code != c.want {
							t.Fatalf("status = %d, want %d", rec.Code, c.want)
						}
						if c.want == http.StatusOK && rec.Body.String() != content {
							t.Errorf("body = %q, want %q", rec.Body.String(), content)
						}
						if c.want != http.StatusOK && strings.Contains(rec.Body.String(), content) {
							t.Error("denied response contains file contents")
						}
						req.Header.Set("Range", "bytes=0-6")
						rec = do(s, req)
						wantRange := c.want
						if c.want == http.StatusOK {
							wantRange = http.StatusPartialContent
							if rec.Body.String() != content[:7] || rec.Header().Get("Accept-Ranges") != "bytes" {
								t.Fatal("download did not preserve the requested bytes and range headers")
							}
						}
						if rec.Code != wantRange {
							t.Fatalf("range status = %d, want %d", rec.Code, wantRange)
						}
						info := httptest.NewRequest(http.MethodGet, "/info?"+query.Encode(), nil)
						authorize(info, transport)
						if rec := do(s, info); rec.Code != c.want {
							t.Fatalf("info status = %d, want %d", rec.Code, c.want)
						}
					})
				}
			}
			for _, transport := range []string{"header", "query"} {
				for _, target := range []string{"/list", "/listRecursive?path=units", "/search?query=contenu"} {
					req := httptest.NewRequest(http.MethodGet, target, nil)
					authorize(req, transport)
					if rec := do(s, req); rec.Code != c.want {
						t.Fatalf("%s %s status = %d, want %d", transport, target, rec.Code, c.want)
					}
				}
				const edited = "document modifie\n"
				mustWriteBytes(t, filepath.Join(root, "modifiable.txt"), []byte(content))
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				part, err := writer.CreateFormFile("file", "modifiable.txt")
				if err != nil {
					t.Fatal(err)
				}
				if _, err := part.Write([]byte(edited)); err != nil {
					t.Fatal(err)
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(http.MethodPut, "/update?path=modifiable.txt", &body)
				req.Header.Set("Content-Type", writer.FormDataContentType())
				authorize(req, transport)
				if rec := do(s, req); rec.Code != c.want {
					t.Fatalf("update status = %d, want %d", rec.Code, c.want)
				}
				wantContent := content
				if c.want == http.StatusOK {
					wantContent = edited
				}
				if got, err := os.ReadFile(filepath.Join(root, "modifiable.txt")); err != nil || string(got) != wantContent {
					t.Fatalf("file after update = %q, %v; want %q", got, err, wantContent)
				}
				req = httptest.NewRequest(http.MethodDelete, "/delete?path=modifiable.txt", nil)
				authorize(req, transport)
				if rec := do(s, req); rec.Code != c.want {
					t.Fatalf("delete status = %d, want %d", rec.Code, c.want)
				}
				got, err := os.ReadFile(filepath.Join(root, "modifiable.txt"))
				if c.want == http.StatusOK {
					if !os.IsNotExist(err) {
						t.Fatalf("file still exists after owner deletion: %v", err)
					}
				} else if err != nil || string(got) != content {
					t.Fatalf("denied deletion changed the file: %q, %v", got, err)
				}
			}
		})
	}
}
