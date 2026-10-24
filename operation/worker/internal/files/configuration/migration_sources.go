package configuration

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type MigrationAssembly struct {
	Base       string   `json:"base"`
	Additional []string `json:"additional"`
}

type MigrationSource struct {
	ID               string `json:"id"`
	Baseline         int    `json:"baseline"`
	LegacyLastScript string `json:"legacyLastScript,omitempty"`
	Dir              string
	Scripts          []MigrationScript
}

var MigrationSourceID = regexp.MustCompile(`^[a-z][a-z0-9._-]*$`)

// Source identities belong to the assembly; paths only locate their resources.
func MigrationSources(cfg *Config) ([]MigrationSource, error) {
	base := strings.TrimSpace(cfg.MigrationsPath)
	manifest := strings.TrimSpace(cfg.MigrationsSources)
	if base != "" && manifest != "" {
		return nil, fmt.Errorf("configure only one of KIAO_WORKER_MIGRATIONS_PATH and KIAO_WORKER_MIGRATIONS_SOURCES")
	}
	if base == "" && manifest == "" {
		return nil, nil
	}
	paths := []string{base}
	if manifest != "" {
		var assembly MigrationAssembly
		if err := readMigrationJSON(manifest, &assembly); err != nil {
			return nil, err
		}
		if strings.TrimSpace(assembly.Base) == "" {
			return nil, fmt.Errorf("migration assembly %s must name a base source", manifest)
		}
		paths = append([]string{assembly.Base}, assembly.Additional...)
		for i, path := range paths {
			if strings.TrimSpace(path) == "" {
				return nil, fmt.Errorf("empty migration source path in %s", manifest)
			}
			if !filepath.IsAbs(path) {
				paths[i] = filepath.Join(filepath.Dir(manifest), path)
			}
		}
	}
	var sources []MigrationSource
	ids, dirs := map[string]bool{}, map[string]bool{}
	for i, path := range paths {
		dir, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		dir, err = filepath.EvalSymlinks(dir)
		if err != nil {
			return nil, fmt.Errorf("migration source %s: %w", path, err)
		}
		var source MigrationSource
		if err := readMigrationJSON(filepath.Join(dir, "source.json"), &source); err != nil {
			return nil, err
		}
		if !MigrationSourceID.MatchString(source.ID) || source.Baseline < 0 {
			return nil, fmt.Errorf("invalid migration source identity or baseline in %s", dir)
		}
		if ids[source.ID] || dirs[dir] {
			return nil, fmt.Errorf("duplicate migration source %q (%s)", source.ID, dir)
		}
		if source.LegacyLastScript != "" {
			match := MigrationNameRe.FindStringSubmatch(source.LegacyLastScript)
			version := 0
			if match != nil {
				version, _ = strconv.Atoi(match[1])
			}
			if i != 0 || version == 0 || version != source.Baseline {
				return nil, fmt.Errorf("legacyLastScript must identify the base source's terminal baseline script in %s", dir)
			}
		}
		source.Dir = dir
		ids[source.ID], dirs[dir] = true, true
		sources = append(sources, source)
	}
	return sources, nil
}

func readMigrationJSON(file string, into any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return fmt.Errorf("read migration configuration %s: %w", file, err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		return fmt.Errorf("parse migration configuration %s: %w", file, err)
	}
	return nil
}
