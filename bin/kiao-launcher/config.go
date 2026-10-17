package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// The machine's standing answers, so that starting an instance is `kiao .` and not four
// exports typed again every time:
//
//	~/.config/kiao/config.env        ($XDG_CONFIG_HOME/kiao/config.env, if that is set)
//
// A config.env still sitting under the pre-rename `kiao-dcms` directory is read instead when
// the new one is absent, so an upgrade keeps the machine's answers without a move.

// `KEY=value` a line, `#` comments, blank lines, and a leading `export ` tolerated so the same file
// can be read by this and sourced by a shell. Values may be quoted; the quotes are not part of them.
//
// **The environment wins.** A variable already set is left alone, so an export before one run still
// overrides the file for that run and nothing has to be edited to try something out.
//
// Every variable it holds is applied, not only the ones this launcher reads itself: the
// worker and the hybridflow-store are children of this process and inherit its environment,
// so this is the one place to answer for all three.
const configName = "config.env"

// secretish are the substrings that make a value worth protecting. A file holding one is refused
// when anybody but its owner can read it — `ssh` does the same for a private key, and for the same
// reason: a token in a world-readable file is a token that has been handed out.
var secretish = []string{"TOKEN", "PASSWORD", "SECRET", "DATABASE_URL"}

// configPath is where that file is, or "" on a system with no home directory to derive it from.
func configPath() string {
	var base string
	if base = strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); base == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return ""
		}
		base = filepath.Join(home, ".config")
	}
	path := filepath.Join(base, "kiao", configName)
	if _, err := os.Stat(path); err == nil {
		return path
	}
	if legacy := filepath.Join(base, "kiao-dcms", configName); fileExists(legacy) {
		return legacy
	}
	return path
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// loadConfig applies that file to this process's environment and reports which file it read. No
// file is not an error: most machines run this command on a folder and need nothing standing.
func loadConfig() (string, error) {
	path := configPath()
	if path == "" {
		return "", nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", path, err)
	}
	defer file.Close()

	settings, err := parseConfig(file)
	if err != nil {
		return "", fmt.Errorf("%s: %w", path, err)
	}
	if info.Mode().Perm()&0o077 != 0 && holdsASecret(settings) {
		return "", fmt.Errorf("%s holds a credential and is readable by others (mode %04o); "+
			"run: chmod 600 %s", path, info.Mode().Perm(), path)
	}
	for _, setting := range settings {
		if _, set := os.LookupEnv(setting.key); set {
			continue
		}
		if err := os.Setenv(setting.key, setting.value); err != nil {
			return "", fmt.Errorf("%s: %s: %w", path, setting.key, err)
		}
	}
	return path, nil
}

type setting struct{ key, value string }

// parseConfig reads the lines, in order, and says which one it could not make sense of rather than
// skipping it: a mistyped line that is silently ignored is a setting somebody believes is in force.
func parseConfig(source io.Reader) ([]setting, error) {
	var settings []setting
	scanner := bufio.NewScanner(source)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		text = strings.TrimPrefix(text, "export ")
		key, value, found := strings.Cut(text, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			return nil, fmt.Errorf("line %d is not KEY=value: %q", line, scanner.Text())
		}
		settings = append(settings, setting{key, unquote(strings.TrimSpace(value))})
	}
	return settings, scanner.Err()
}

// unquote drops one matching pair of surrounding quotes, so that a value written the way a shell
// would take it means the same thing here.
func unquote(value string) string {
	if len(value) >= 2 {
		if first, last := value[0], value[len(value)-1]; first == last && (first == '"' || first == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

func holdsASecret(settings []setting) bool {
	for _, setting := range settings {
		if setting.value == "" {
			continue
		}
		for _, mark := range secretish {
			if strings.Contains(strings.ToUpper(setting.key), mark) {
				return true
			}
		}
	}
	return false
}
