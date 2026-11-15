package muse

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	turntrace "kiao/worker/internal/hybridflow-runner/conversations/trace"
	pkgSkills "kiao/worker/internal/hybridflow-runner/skills"
)

// stageMuseConfig points the host at the turn's own configuration: a settings.json carrying the
// ledger's servers with the credentials written in, beside the staged skills and a symlink to the
// login the host is still the user's own. It answers the staging directory — "" for a turn handed
// no servers, which runs with the user's configuration untouched — and the environment the host is
// spawned with.
//
// **No trust.json is staged**, and that absence is the point. Without one the workspace is
// untrusted, so no project skill, rule or MCP declaration loads from the store — the counterpart
// of the Claude driver's --setting-sources user, for a CLI with no such flag. The DCMS skills
// travel as user skills instead (stageMuseSkills): a turn reads those, the user's own skills and
// the toolbox's servers, and nothing the folder it works in declares.
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
	if err := StageMuseSkills(filepath.Join(configDir, "skills"), run.StoreRoot); err != nil {
		return fail(fmt.Errorf("The turn could not be given its skills: %w", err))
	}
	// The login, linked rather than copied: the host reads through the link, and nothing secret is
	// duplicated into a directory keyed by turn. Left out when there is nothing to link — a host
	// with no login says so honestly when the turn runs.
	if home, err := os.UserHomeDir(); err == nil {
		auth := filepath.Join(museConfigDir(home), "muse", "auth.json")
		if _, err := os.Stat(auth); err == nil {
			_ = os.Symlink(auth, filepath.Join(configDir, "auth.json"))
		}
	}
	return staging, museEnvWith(filepath.Join(staging, "config")), nil
}

// StageMuseSkills builds the skills directory a staged turn reads as its user skills: the store's
// DCMS skills, plus the user's own, each linked rather than copied. It is a directory of links
// rather than a link to a directory because the two halves live in two places — the store and the
// user's config home — and the host reads only one.
//
// Only a store skill carrying this installer's marker travels. The staged workspace is untrusted
// on purpose (stageConfig), so a project skill would not load from the store — and the store's own
// skills, or ones that arrived through `git pull`, must not reach the turn through this door
// either. Where both halves name a skill, the user's own wins: it is the skill nobody here wrote,
// and overwriting it here would undo the foreign rule that protects it everywhere else.
//
// Left out when there is nothing to link, like the login: no store skills, no user skills, no
// directory.
func StageMuseSkills(dir, storeRoot string) error {
	links := map[string]string{}
	if root := strings.TrimSpace(storeRoot); root != "" {
		if entries, err := os.ReadDir(pkgSkills.StoreAgentsSkills(root)); err == nil {
			for _, entry := range entries {
				if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
					continue
				}
				abs := filepath.Join(pkgSkills.StoreAgentsSkills(root), entry.Name())
				if _, err := pkgSkills.ReadSkillMarker(abs); err != nil {
					continue // the store's own, or arrived uninvited: not ours to hand over
				}
				links[entry.Name()] = abs
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if userSkills := strings.TrimSpace(pkgSkills.DefaultMuseSkillsPath(home)); userSkills != "" {
			if entries, err := os.ReadDir(userSkills); err == nil {
				for _, entry := range entries {
					if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
						continue
					}
					links[entry.Name()] = filepath.Join(userSkills, entry.Name())
				}
			}
		}
	}
	if len(links) == 0 {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(dir, name)); err != nil {
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
	if root := pkgSkills.StoreRootOf(d.Cfg); root != "" {
		skills = pkgSkills.StoreAgentsSkills(root)
	}
	// A staged turn reads neither that directory nor the user's own, but the merge of the two
	// StageMuseSkills built for it — which is deleted with the turn, so the names are recorded
	// while it still exists. What the trace keeps of a staging is the names, not the contents:
	// those live on in the store and the user's home.
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

// museConfigDir is where the CLI keeps its configuration: the XDG config home, or the home it
// falls back on. It is the staging half of defaultMuseSkillsPath, which names the skills under it.
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
