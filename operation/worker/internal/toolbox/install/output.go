package install

import (
	"kiao/worker/internal/core/process"
	"os"
	"regexp"
	"strings"
	"time"
)

// versionOf asks a binary what it is. A version is decoration on a panel row: a binary that refuses
// to answer is not a failed install, so this reports an empty string rather than an error.
func (in *installer) versionOf(bin string, arg string) (string, error) {
	res := process.RunProc([]string{bin, arg}, in.cfg.Prefix, 30*time.Second, in.cfg.InstallEnv())
	if !res.OK() {
		return "", nil
	}
	return process.FirstLine(res.Combined()), nil
}

func firstError(errs ...error) error {
	for _, err := range errs {
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// errorLine matches the line a tool states its actual complaint on. Looked for before falling back
// to the tail, because a helpful tool follows its error with paragraphs of advice — and the tail of
// `playwright install` is the bottom edge of an ASCII box, which is what the panel was showing where
// the reason should have been.
var errorLine = regexp.MustCompile(`(?i)\b(error|fatal|cannot|failed|no such|not found|refused)\b`)

// firstLines is what a failure carries into an HTTP error and a log line: enough of the tool's own
// complaint to act on, without the hundred lines of a pip resolution behind it. The whole output is
// in the job log either way.
func firstLines(s string, n int) string {
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		// Box drawing and rules carry nothing and crowd out what does.
		if trimmed := strings.Trim(line, " \t║╔╗╚╝═─│┌┐└┘*#=-"); trimmed != "" {
			lines = append(lines, strings.TrimSpace(line))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	var complaints []string
	for _, line := range lines {
		if errorLine.MatchString(line) {
			complaints = append(complaints, line)
		}
	}
	if len(complaints) > 0 {
		lines = complaints
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.TrimSpace(strings.Join(lines, "; "))
}
