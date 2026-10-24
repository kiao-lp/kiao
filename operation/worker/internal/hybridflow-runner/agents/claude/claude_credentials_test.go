package claude

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The file's shape, pinned: both stamps are epoch **milliseconds**. Read as seconds they would land
// in 1970, and every session on the host would read as long dead — which is this check's own
// failure mode, a sign-in banner permanently over a working session.
func TestReadClaudeCredentialsShape(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".credentials.json")
	body := `{"claudeAiOauth":{"accessToken":"sk-ant-oat01-x","expiresAt":1787796085158,"refreshTokenExpiresAt":1790289304158}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	creds, err := readClaudeCredentials(path)
	if err != nil {
		t.Fatalf("readClaudeCredentials: %v", err)
	}
	if creds.AccessToken != "sk-ant-oat01-x" {
		t.Errorf("accessToken = %q", creds.AccessToken)
	}
	if want := time.UnixMilli(1787796085158); !creds.ExpiresAt.Equal(want) {
		t.Errorf("expiresAt = %s, want %s", creds.ExpiresAt, want)
	}
	if want := time.UnixMilli(1790289304158); !creds.RefreshTokenExpiresAt.Equal(want) {
		t.Errorf("refreshTokenExpiresAt = %s, want %s", creds.RefreshTokenExpiresAt, want)
	}
}

// A refresh expiry the file does not carry must stay the zero time. Mapping it to epoch 0 would
// make every such session read as expired — an older CLI, or an auth method with no refresh token,
// reported as signed out for good.
func TestReadClaudeCredentialsWithoutRefreshExpiry(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".credentials.json")
	if err := os.WriteFile(path, []byte(`{"claudeAiOauth":{"accessToken":"t","expiresAt":1787796085158}}`), 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	creds, err := readClaudeCredentials(path)
	if err != nil {
		t.Fatalf("readClaudeCredentials: %v", err)
	}
	if !creds.RefreshTokenExpiresAt.IsZero() {
		t.Errorf("absent refreshTokenExpiresAt = %s, want the zero time", creds.RefreshTokenExpiresAt)
	}
	if !creds.renewable(time.Now()) {
		t.Errorf("a session whose file names no refresh expiry must not be read as expired")
	}
}

func TestReadClaudeCredentialsUnreadable(t *testing.T) {
	dir := t.TempDir()
	if _, err := readClaudeCredentials(filepath.Join(dir, "absent.json")); err == nil {
		t.Errorf("missing file: expected an error")
	}
	path := filepath.Join(dir, "malformed.json")
	if err := os.WriteFile(path, []byte(`{not json`), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := readClaudeCredentials(path); err == nil {
		t.Errorf("malformed file: expected an error")
	}
}

// renewable is the whole distinction between the two expiries, and getting it backwards breaks the
// panel in one direction or the other: too strict and a banner sits over a working session, too lax
// and a dead one is never reported.
func TestClaudeCredentialsRenewable(t *testing.T) {
	now := time.Now()
	cases := map[string]struct {
		creds ClaudeCredentials
		want  bool
	}{
		// The routine state, several times a day: the CLI renews the access token on the next call.
		"access token expired, refresh token alive": {
			ClaudeCredentials{AccessToken: "t", ExpiresAt: now.Add(-2 * time.Hour), RefreshTokenExpiresAt: now.Add(20 * 24 * time.Hour)},
			true,
		},
		"both alive": {
			ClaudeCredentials{AccessToken: "t", ExpiresAt: now.Add(2 * time.Hour), RefreshTokenExpiresAt: now.Add(20 * 24 * time.Hour)},
			true,
		},
		// The reported failure: nothing unattended can bring this host back.
		"refresh token expired": {
			ClaudeCredentials{AccessToken: "t", ExpiresAt: now.Add(-2 * time.Hour), RefreshTokenExpiresAt: now.Add(-time.Hour)},
			false,
		},
		// Right on the boundary the session is over: the expiry is when it stops working, not the
		// last moment it does.
		"refresh token expiring exactly now": {
			ClaudeCredentials{AccessToken: "t", RefreshTokenExpiresAt: now},
			false,
		},
		// What the CLI leaves behind when it gives up on a session itself.
		"tokens blanked in place": {
			ClaudeCredentials{AccessToken: "", RefreshTokenExpiresAt: now.Add(20 * 24 * time.Hour)},
			false,
		},
		"nothing at all": {ClaudeCredentials{}, false},
	}

	for name, tc := range cases {
		if got := tc.creds.renewable(now); got != tc.want {
			t.Errorf("%s: renewable = %v, want %v", name, got, tc.want)
		}
	}
}
