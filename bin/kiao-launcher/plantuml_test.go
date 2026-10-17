package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixture is what the SPA actually puts in a URL: `plantumlEncoder.encode` from the
// plantuml-encoder package, on the source below. Decoding is the one thing here that reimplements
// somebody else's format, so it is checked against that package's own output rather than against a
// round trip through this file.
const (
	encodedDiagram = "SoWkIImgAStDuNBAJrBGjLDmpCbCJhLIo4ZDoSddSaZDIodDpG40"
	decodedDiagram = "@startuml\nBob -> Alice: hello\n@enduml"
)

func TestDecodePlantUML(t *testing.T) {
	source, err := decodePlantUML(encodedDiagram)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The last four-character group decodes to three bytes whether the deflate stream needed them
	// or not, so the source is a prefix of what comes out rather than all of it.
	if !strings.HasPrefix(source, decodedDiagram) {
		t.Fatalf("decoded %q, want it to start with %q", source, decodedDiagram)
	}
}

func TestDecodePlantUMLRejectsGarbage(t *testing.T) {
	if _, err := decodePlantUML("not-a-diagram"); err == nil {
		t.Fatal("garbage decoded without an error")
	}
}

// The jar the install script ships is what a diagram renders with — that is the whole point of
// shipping one — and a machine without a JVM says so rather than complaining about a missing
// renderer. java is pinned here rather than looked up, so the test says the same thing on a
// build machine that has one and on a container that does not.
func TestDetectPrefersTheShippedJar(t *testing.T) {
	t.Setenv("PLANTUML_JAR", "")
	installDir := t.TempDir()
	jar := filepath.Join(installDir, "lib", "plantuml.jar")
	if err := os.MkdirAll(filepath.Dir(jar), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(jar, []byte("not really a jar"), 0o644); err != nil {
		t.Fatal(err)
	}

	withJava := &plantUML{java: "/usr/bin/java"}
	withJava.detect(installDir)
	if withJava.jar != jar {
		t.Errorf("detect chose %q, want the shipped %q", withJava.jar, jar)
	}
	if !withJava.available() {
		t.Error("a shipped jar and a java is not available")
	}

	noJava := &plantUML{}
	noJava.detect(installDir)
	if noJava.jar != "" {
		t.Errorf("chose the jar %q with no java to run it with", noJava.jar)
	}
	if title, _ := noJava.unavailable(); !strings.Contains(title, "Java") {
		t.Errorf("with the jar there but no JVM, the notice says %q", title)
	}
}

func TestBackendPath(t *testing.T) {
	// The mapping nginx does in the image and vite does in dev; getting it wrong is a SPA that
	// loads and then cannot list a folder.
	for _, c := range []struct{ in, want string }{
		{"/api/files/list", "/list"},
		{"/api/files/git/status", "/git/status"},
		{"/api/files/claude/usage", "/claude/usage"},
		{"/api/files", "/"},
		{"/api/ws/claude", "/ws/claude"},
		{"/api/ws/hybridflow-runner", "/ws/hybridflow-runner"},
		{"/api/claude/options", "/claude/options"},
		{"/api/agents/options", "/agents/options"},
		{"/api/hybridflow-runner/options", "/hybridflow-runner/options"},
	} {
		if got := backendPath(c.in); got != c.want {
			t.Errorf("backendPath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
