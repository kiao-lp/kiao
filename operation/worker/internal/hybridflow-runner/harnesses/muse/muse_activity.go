package muse

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// museActivity is the relay's notification census and silence clock.
type museActivity struct {
	counts map[string]int
	last   string
	at     time.Time
}

// note files one notification in the turn's census: counted by method, the most recent
// one remembered. Called for every frame the host sends, including the ones the relay steps
// over in silence — the census is the record that stepping over leaves.
func (a *museActivity) note(method string) {
	if a.counts == nil {
		a.counts = map[string]int{}
	}
	a.counts[method]++
	a.last = method
	a.at = time.Now()
}

// summary reports notification counts, methods and the last event on one line.
// It names an empty stream explicitly and includes the elapsed silence when at least one second.
func (a *museActivity) summary() string {
	quiet := a.quietSuffix()
	if len(a.counts) == 0 {
		return "the host sent nothing" + quiet
	}
	methods := make([]string, 0, len(a.counts))
	total := 0
	for method, n := range a.counts {
		methods = append(methods, method)
		total += n
	}
	sort.Strings(methods)
	parts := make([]string, 0, len(methods))
	for _, method := range methods {
		parts = append(parts, fmt.Sprintf("%s=%d", method, a.counts[method]))
	}
	// Methods are the host's own vocabulary: bounded here rather than trusted, the way the
	// trace bounds the line itself.
	tail := ""
	if len(parts) > maxSummaryMethods {
		tail = " …"
		parts = parts[:maxSummaryMethods]
	}
	unit := "events"
	if total == 1 {
		unit = "event"
	}
	return fmt.Sprintf("%d %s (%s%s), last %s%s",
		total, unit, strings.Join(parts, " "), tail, a.last, quiet)
}

// quietSuffix dates silence only after the relay has started its clock.
func (a *museActivity) quietSuffix() string {
	if a.at.IsZero() {
		return ""
	}
	if quiet := time.Since(a.at); quiet >= time.Second {
		return "; quiet for " + quiet.Truncate(time.Second).String()
	}
	return ""
}

// quietFor is the same silence as a bare duration for the nudge: "2m0s", never empty, so a
// sentence built from it always reads. The relay sets the clock it reads from, so the fallback
// is unreachable outside a driver built by hand.
func (a *museActivity) quietFor() string {
	if a.at.IsZero() {
		return "a while"
	}
	return time.Since(a.at).Truncate(time.Second).String()
}

// quietNotice reports the elapsed silence and includes a retry count after a blocked turn resumes.
func (d *MuseDriver) quietNotice() string {
	relaunches := d.recovery.relaunches

	notice := "Muse has been quiet for " + d.activity.quietFor() + "; the turn is still running."
	if relaunches > 0 {
		notice += fmt.Sprintf(" (relance %d)", relaunches)
	}
	return notice
}

// endCensus is the census as an end note keeps it: the count, the quiet behind it, and where
// the host's own account of the turn lives — the session journal the CLI keeps on disk whether
// this service asked for the protocol stream or not. Every end goes through it, so a
// post-mortem starts from a file rather than from a session id.
func (d *MuseDriver) endCensus() string {
	summary := d.activity.summary()
	sessionID := d.host.snapshot().sessionID
	if path := MuseHostSessionLog(sessionID); path != "" {
		summary += "; host session log " + path
	}
	return summary
}

// museHostSessionLog is the CLI's own journal for one of its sessions: the per-attempt record
// of what the host did, down to the provider retries it never announces over MSP. "" is
// unresolvable — no session, no data home, or no such file — which reads as no suffix rather
// than as a guess: a wrong path in a trace is worse than none.
//
// The layout is the CLI's own — sessions/<date>/<session>/session.jsonl under the data home —
// so the dated path is tried first and a glob second. The date is local, the way the CLI writes
// it, on the machine they share.
func MuseHostSessionLog(sessionID string) string {
	if sessionID == "" || strings.ContainsAny(sessionID, `/\`) || strings.Contains(sessionID, "..") {
		return ""
	}
	dataHome := museDataHome()
	if dataHome == "" {
		return ""
	}
	base := filepath.Join(dataHome, "muse", "sessions")
	dated := filepath.Join(base, time.Now().Format("2006/01/02"), sessionID, "session.jsonl")
	if info, err := os.Stat(dated); err == nil && !info.IsDir() {
		return dated
	}
	matches, _ := filepath.Glob(filepath.Join(base, "*", "*", "*", sessionID, "session.jsonl"))
	sort.Strings(matches)
	// Latest first: a session id is unique, but a stale same-named directory costs nothing
	// to step over, and a same-named directory is all it can ever be.
	for i := len(matches) - 1; i >= 0; i-- {
		if info, err := os.Stat(matches[i]); err == nil && !info.IsDir() {
			return matches[i]
		}
	}
	return ""
}

// museDataHome is where the CLI keeps what outlives a host: sessions, and the journal above.
// The config home is staged per turn and deleted with it, but the data home is the user's own
// and shared by every turn — which is what leaves a stopped turn anything to point at.
func museDataHome() string {
	if dir := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".local", "share")
}

// maxSummaryMethods bounds the census line: a turn hears a handful of methods, and anything
// past this is the host speaking a vocabulary nobody taught the driver.
const maxSummaryMethods = 12

// endWord names how the turn ended for the trace: the host's own terminal word, the reclaim
// for a turn that never ran — which carries none, per the schema — or the compaction for a
// turn whose work was one.
func (d *MuseDriver) endWord(method, terminal string) string {
	if terminal != "" {
		return terminal
	}
	if method == "turn/unqueued" {
		return "unqueued"
	}
	compacting := d.host.snapshot().compacting
	if compacting {
		return "compacted"
	}
	return method
}
