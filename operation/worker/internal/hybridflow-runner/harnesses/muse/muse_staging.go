package muse

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
)

// stageMuseConfig stages the turn's MCP settings with links to the user's login and skills.
// Omitting trust.json keeps the workspace untrusted. The agent's catalogue arrives in its instructions.
func stageMuseConfig(run MuseRun) (string, []string, error) {
	if strings.TrimSpace(run.McpConfig) == "" {
		return "", nil, nil
	}
	staging, err := os.MkdirTemp("", "muse-turn-")
	if err != nil {
		return "", nil, fmt.Errorf("The turn could not be given its tools: %w", err)
	}
	// Everything below removes the directory on the way out; the turn's credential lives in it.
	fail := func(err error) (string, []string, error) {
		os.RemoveAll(staging)
		return "", nil, err
	}
	configDir := filepath.Join(staging, "config", "muse")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return fail(fmt.Errorf("The turn could not be given its tools: %w", err))
	}
	settings := museSettings(substituteMuseMCPPlaceholders(run.McpConfig, run.McpToken))
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), []byte(settings), 0o600); err != nil {
		return fail(fmt.Errorf("The turn could not be given its tools: %w", err))
	}
	if home, err := os.UserHomeDir(); err == nil {
		userConfig := filepath.Join(museConfigDir(home), "muse")
		if err := stageMuseUserSkills(filepath.Join(configDir, "skills"), filepath.Join(userConfig, "skills")); err != nil {
			return fail(fmt.Errorf("The turn could not be given its skills: %w", err))
		}
		auth := filepath.Join(userConfig, "auth.json")
		if _, err := os.Stat(auth); err == nil {
			_ = os.Symlink(auth, filepath.Join(configDir, "auth.json"))
		}
	}
	return staging, museEnvWith(filepath.Join(staging, "config")), nil
}

func stageMuseUserSkills(dir, source string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || strings.HasPrefix(name, ".") {
			continue
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if err := os.Symlink(filepath.Join(source, name), filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

// museSettings is the settings.json a staged turn is given: this service's whole say in how the
// host is configured, which is the servers and nothing else.
func museSettings(servers string) string {
	return `{"schema_version":1,"mcp_servers":` + servers + `}`
}

// execRecord is how this turn's host was actually run, for the trace.
//
// Muse is the case the run record exists for. Its argument list says almost nothing — `muse serve`
// and no more — because everything about the turn is in a settings.json staged in a temporary
// directory, pointed at with XDG_CONFIG_HOME, and deleted on the way out with the turn's credential
// in it. Without this line the only copy of what the turn was handed dies with the turn. What is
// recorded is that file as it stood *before* the credentials were written into it: the same text
// for every turn, and nothing that has to be kept secret.
func (d *MuseDriver) execRecord(cmd *exec.Cmd, run MuseRun) turntrace.TraceExec {
	path, version := turntrace.BinaryVersion(d.Binary)
	skills := ""
	if d.stagingDir != "" {
		if staged := filepath.Join(d.stagingDir, "config", "muse", "skills"); turntrace.IsSkillsDir(staged) {
			skills = staged
		}
	}
	rec := turntrace.TraceExec{
		Binary: d.Binary, Path: path, Version: version,
		Argv: cmd.Args, Env: turntrace.AddedEnv(cmd.Env), Dir: cmd.Dir,
		SkillsPath: skills, Skills: turntrace.InstalledSkills(skills),
	}
	if cmd.Process != nil {
		rec.PID = cmd.Process.Pid
	}
	if strings.TrimSpace(run.McpConfig) != "" {
		rec.Config = museSettings(run.McpConfig)
	}
	return rec
}

// museConfigDir is the CLI's configuration root.
func museConfigDir(home string) string {
	if configHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configHome != "" {
		return configHome
	}
	return filepath.Join(home, ".config")
}

// museEnvWith is this process's environment with XDG_CONFIG_HOME pointed at the staged
// configuration. The key is replaced rather than appended: a duplicated variable leaves which of
// the two a process reads to the reader.
func museEnvWith(configHome string) []string {
	env := os.Environ()
	out := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if !strings.HasPrefix(entry, "XDG_CONFIG_HOME=") {
			out = append(out, entry)
		}
	}
	return append(out, "XDG_CONFIG_HOME="+configHome)
}

// cleanup removes the staged configuration, with the turn's credential in it. Called on every way
// out of a staged turn — a failed spawn, the reader's end — and safe to call for one that staged
// nothing.
func (d *MuseDriver) cleanup() {
	staging := d.stagingDir
	d.stagingDir = ""

	if staging != "" {
		os.RemoveAll(staging)
	}
}
