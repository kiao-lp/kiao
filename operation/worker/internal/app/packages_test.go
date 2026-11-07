package app

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestPackageDependenciesFollowResponsibilities(t *testing.T) {
	root := filepath.Join("..", "..", "internal")
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, filepath.Dir(path))
		if err != nil {
			return err
		}
		source := filepath.ToSlash(rel)
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, spec := range file.Imports {
			target, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			if reason := forbiddenDependency(source, target); reason != "" {
				t.Errorf("%s imports %s: %s", path, target, reason)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func forbiddenDependency(source, target string) string {
	const prefix = "kiao/worker/internal/"
	if strings.HasPrefix(target, prefix) {
		destination := strings.TrimPrefix(target, prefix)
		family := strings.Split(source, "/")[0]
		other := strings.Split(destination, "/")[0]
		if family != "app" && family != other && other != "core" {
			return "only app assembles different service families"
		}
		if source == "core" || strings.HasPrefix(source, "core/") {
			return ""
		}
		if source == "files/search" && strings.HasPrefix(destination, "files/content") {
			return "search is independent of file mutations"
		}
		if source == "hybridflow-runner/agents" || strings.HasPrefix(source, "hybridflow-runner/turns") {
			for _, adapter := range []string{"claude", "codex", "muse", "opencode", "pi"} {
				if strings.HasPrefix(destination, "hybridflow-runner/agents/"+adapter) {
					return "agent contracts and turn execution are independent of concrete drivers"
				}
			}
			if strings.HasPrefix(destination, "hybridflow-runner/http") || destination == "hybridflow-runner/assembly" {
				return "transport and assembly depend on execution"
			}
		}
	}
	if strings.HasPrefix(source, "hybridflow-runner/turns") &&
		(target == "net/http" || target == "github.com/gorilla/websocket" || target == prefix+"core/http") {
		return "turn execution uses connection contracts"
	}
	return ""
}
