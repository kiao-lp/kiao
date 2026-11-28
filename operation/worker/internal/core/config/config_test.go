package config

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigDCMSRoot(t *testing.T) {
	configured := t.TempDir()
	legacy := t.TempDir()
	cases := []struct {
		name       string
		configured string
		legacy     string
		want       string
	}{
		{name: "default", want: "/tmp"},
		{name: "canonical setting", configured: configured, want: configured},
		{name: "legacy setting", legacy: legacy, want: legacy},
		{name: "canonical setting takes precedence", configured: configured, legacy: legacy, want: configured},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("KIAO_WORKER_DCMS_ROOT", c.configured)
			t.Setenv("KIAO_WORKER_ROOT_PATH", c.legacy)
			t.Setenv("KIAO_WORKER_STATE_PATH", "")
			cfg := LoadConfig()
			if cfg.DCMSRoot != c.want {
				t.Errorf("DCMSRoot = %q, want %q", cfg.DCMSRoot, c.want)
			}
			if wantState := filepath.Join(c.want, StateDirName); cfg.StatePath != wantState {
				t.Errorf("StatePath = %q, want %q", cfg.StatePath, wantState)
			}
		})
	}
}

// TestConfigValidate covers the socle's own checks: the DCMS root, the state path, the auth mode.
// Each half adds its own on top and the program reports one list.
func TestConfigValidate(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name  string
		cfg   Config
		wantN int
	}{
		{"valid prod", Config{DCMSRoot: dir, StatePath: dir, AuthMode: "prod", IssuerURI: "i", JwkSetURI: "j"}, 0},
		{"valid debug", Config{DCMSRoot: dir, StatePath: dir, AuthMode: "debug"}, 0},
		{"empty root", Config{DCMSRoot: "", StatePath: dir, AuthMode: "debug"}, 1},
		{"missing root", Config{DCMSRoot: filepath.Join(dir, "nope"), StatePath: dir, AuthMode: "debug"}, 1},
		// Everything the service owns hangs off the state path. The default is absolute whatever the
		// DCMS root looks like, so a relative one is always hand-configured — and it would land the
		// registries at the working directory ("/" for a systemd unit) rather than in the store.
		{"empty state path", Config{DCMSRoot: dir, StatePath: "", AuthMode: "debug"}, 1},
		{"relative state path", Config{DCMSRoot: dir, StatePath: ".kiao-config", AuthMode: "debug"}, 1},
		{"unknown auth mode", Config{DCMSRoot: dir, StatePath: dir, AuthMode: "test"}, 1},
		{"prod without issuer and jwks", Config{DCMSRoot: dir, StatePath: dir, AuthMode: "prod"}, 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.Validate(); len(got) != c.wantN {
				t.Errorf("Validate() = %v (%d problems), want %d", got, len(got), c.wantN)
			}
		})
	}
}
