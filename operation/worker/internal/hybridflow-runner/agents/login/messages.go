package login

import (
	"regexp"
	"strings"
	"time"
)

// museAuthSetTimeout bounds `muse auth set`. It is a local file write; the bound is for a
// machine having a bad minute, not for the command being long.
const MuseAuthSetTimeout = 30 * time.Second

// deviceURLTimeout bounds how long the CLI may take to print the sign-in page.
const deviceURLTimeout = 30 * time.Second

// deviceSessionTTL kills a device flow nobody finished. Meta expires the code on its own side
// regardless; this is what stops an abandoned process from polling forever.
const deviceSessionTTL = 10 * time.Minute

// deviceURLRe matches the sign-in page the CLI prints ("Open this page to sign in:\n
// https://…"). It is only ever applied to complete lines, so a read that splits the URL cannot
// yield a truncated match.
var DeviceURLRe = regexp.MustCompile(`https://\S+`)

// cleanAPIKeyMessage turns the CLI's output into something worth showing: trimmed and capped. The
// key itself never passes through here — it went in on stdin, and nothing the CLI prints repeats
// it.
func CleanAPIKeyMessage(out []byte) string {
	s := strings.TrimSpace(string(out))
	if len(s) > MaxLoginMessage {
		s = s[:MaxLoginMessage] + "…"
	}
	return s
}

// cleanDeviceMessage turns captured CLI output into something worth showing: trimmed and capped.
func CleanDeviceMessage(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > MaxLoginMessage {
		s = s[:MaxLoginMessage] + "…"
	}
	return s
}
