package protocol

import (
	"strings"
	"time"
)

const MaxBlockResultChars = 8 * 1024

const TruncationMarker = "\n\n…[reply truncated by worker]"

// Fixed-width UTC milliseconds permit chronological string comparison.
// RFC3339Nano trims zeros, so ".1Z" would sort after ".10001Z".
const ConversationTimeFormat = "2006-01-02T15:04:05.000Z07:00"

func NowConversationTime() string { return time.Now().UTC().Format(ConversationTimeFormat) }

func CapRecordText(text string, max int) (string, bool) {
	if runes := []rune(text); len(runes) > max {
		return string(runes[:max]) + TruncationMarker, true
	}
	return text, false
}

func CollapseWhitespace(s string) string { return strings.Join(strings.Fields(s), " ") }
