package mcp

import (
	"context"
	"kiao/worker/internal/core/equipment"
	"kiao/worker/internal/core/filesystem"
	mcpwire "kiao/worker/internal/core/mcp"
	"kiao/worker/internal/core/process"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"maps"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func ProbeServer(cfg *toolconfig.Config, command string, args []string, env map[string]string) (mcpwire.ProbeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	values := make(map[string]string, len(env)+1)
	maps.Copy(values, env)
	values["PATH"] = cfg.InstallEnv()["PATH"]
	result, failure := mcpwire.Probe(ctx, equipment.MCPServer{Type: equipment.MCPStdio, Command: command, Args: args, Env: values}, cfg.Prefix)
	if failure != nil {
		return result, failure
	}
	return result, nil
}

// present answers whether a runtime is on this machine at all, and what version — including one
// that was there before the panel existed. The prefix is looked in first, because a machine may
// well have both and the one a turn will use is this service's.
//
// The distinction matters for what the row offers: something the ledger claims is `installed` and
// something merely `present` look the same to a turn and are completely different to an uninstall
// button, which has no business removing a JDK the operator installed themselves.
//
// **All of it, or none of it.** A runtime is what its dependents reach for, not one file with the
// right name: Ubuntu's `nodejs` package is a node with no npm beside it, and calling that Node
// present is what made the panel skip installing a real one and then fail an npm-channel install on
// a missing npm. The second answer names the first thing that was not found, so the row can say why
// it is offering an install for something the machine appears to have.
func Present(cfg *toolconfig.Config, recipe toolcatalog.Recipe) (version string, missing string, ok bool) {
	if recipe.Bin == "" {
		return "", "", false
	}
	path, found := locate(cfg, recipe.Bin)
	if !found {
		return "", recipe.Bin, false
	}
	for _, also := range recipe.AlsoProvides {
		if _, found := locate(cfg, also); !found {
			return "", also, false
		}
	}
	return probeVersion(cfg, path), "", true
}

// locate finds one executable, the toolbox's copy first and the machine's after. Absolute either
// way: what is answered is asked for a version and named in a reason, and neither wants a bare name.
func locate(cfg *toolconfig.Config, bin string) (string, bool) {
	candidates := []string{
		filepath.Join(cfg.BinDir(), bin),
		filepath.Join(cfg.NodeDir(), "bin", bin),
		filepath.Join(cfg.JavaDir(), "bin", bin),
	}
	for _, candidate := range candidates {
		if filesystem.FileExists(candidate) {
			return candidate, true
		}
	}
	if path, err := exec.LookPath(bin); err == nil {
		return path, true
	}
	return "", false
}

// probeVersion asks a binary what it is: `--version`, which node, uv, python and java 21 all answer,
// then `-version`, the only spelling ffmpeg knows — it exits 8 on the other — and then `-V`, the
// only spelling dot knows, which it prints to stderr. A tool that will not say is still installed,
// so this never fails.
func probeVersion(cfg *toolconfig.Config, bin string) string {
	for _, flag := range []string{"--version", "-version", "-V"} {
		res := process.RunProc([]string{bin, flag}, cfg.Prefix, 15*time.Second, cfg.InstallEnv())
		if res.OK() {
			return VersionLine(res.Combined())
		}
	}
	return ""
}

// versionLine is the first line of what a tool says it is, without the copyright ffmpeg follows its
// version with on that same line.
func VersionLine(said string) string {
	line, _, _ := strings.Cut(process.FirstLine(said), " Copyright")
	return strings.TrimSpace(line)
}
