package filesystem

import (
	"os"
	"strings"
	"unicode/utf8"
)

// readFileText rejects non-UTF-8/unreadable files, normalizes line endings and strips one
// trailing newline. Keeping it separate lets needle checks precede line splitting.
func ReadFileText(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	if !utf8.Valid(data) {
		return "", false
	}
	s := string(data)
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.TrimSuffix(s, "\n"), true
}

func SplitTextLines(s string) []string {
	return strings.Split(s, "\n")
}

// readLines strips line terminators, matching Files.readAllLines.
func ReadLines(path string) ([]string, bool) {
	s, ok := ReadFileText(path)
	if !ok {
		return nil, false
	}
	return SplitTextLines(s), true
}

// writeLines appends a newline to every line (Files.write on Linux).
// Atomic replacement prevents readers from seeing truncated files and leaves whole files on failure.
func WriteLines(path string, lines []string) error {
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(line)
		b.WriteString("\n")
	}
	// Preserve the existing mode; the fallback applies if the file disappeared during the pass.
	return WriteFileAtomic(path, []byte(b.String()), ExistingFileMode(path, 0o644))
}
