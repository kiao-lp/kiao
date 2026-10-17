package core

import (
	"path/filepath"
	"testing"
)

// TestConfigValidate covers the socle's own checks: the data root, the state path, the auth mode.
// Each half adds its own on top and the program reports one list.
func TestConfigValidate(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name  string
		cfg   Config
		wantN int
	}{
		{"valid prod", Config{RootPath: dir, StatePath: dir, AuthMode: "prod", IssuerURI: "i", JwkSetURI: "j"}, 0},
		{"valid debug", Config{RootPath: dir, StatePath: dir, AuthMode: "debug"}, 0},
		{"empty root", Config{RootPath: "", StatePath: dir, AuthMode: "debug"}, 1},
		{"missing root", Config{RootPath: filepath.Join(dir, "nope"), StatePath: dir, AuthMode: "debug"}, 1},
		// Everything the service owns hangs off the state path. The default is absolute whatever the
		// data root looks like, so a relative one is always hand-configured — and it would land the
		// registries at the working directory ("/" for a systemd unit) rather than in the store.
		{"empty state path", Config{RootPath: dir, StatePath: "", AuthMode: "debug"}, 1},
		{"relative state path", Config{RootPath: dir, StatePath: ".kiao-config", AuthMode: "debug"}, 1},
		{"unknown auth mode", Config{RootPath: dir, StatePath: dir, AuthMode: "test"}, 1},
		{"prod without issuer and jwks", Config{RootPath: dir, StatePath: dir, AuthMode: "prod"}, 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.Validate(); len(got) != c.wantN {
				t.Errorf("Validate() = %v (%d problems), want %d", got, len(got), c.wantN)
			}
		})
	}
}
