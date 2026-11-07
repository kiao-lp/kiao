package protocol

import (
	"encoding/json"
	"strings"
)

// Permission previews need more context than the 80-character tool label.
const MaxPermissionInputChars = 4000

// The CLI requires an object, not null, for tool input on allow.
func OrEmptyInput(input any) any {
	if input == nil {
		return map[string]any{}
	}
	return input
}

func PermissionInputSummary(input any) string {
	if input == nil {
		return ""
	}
	raw, ok := input.(string)
	if !ok {
		b, err := json.MarshalIndent(input, "", "  ")
		if err != nil {
			return ""
		}
		raw = string(b)
	}
	return CutRunes(raw, MaxPermissionInputChars)
}

func CutRunes(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max]) + "…"
}

func ResultSummary(output any) string {
	switch out := output.(type) {
	case nil:
		return ""
	case string:
		return CutRunes(out, MaxBlockResultChars)
	case []any:
		var parts []string
		for _, entry := range out {
			switch e := entry.(type) {
			case string:
				parts = append(parts, e)
			case map[string]any:
				if text := AsString(e["text"]); text != "" {
					parts = append(parts, text)
				} else if data, err := json.Marshal(e); err == nil {
					parts = append(parts, string(data))
				}
			}
		}
		return CutRunes(strings.Join(parts, "\n"), MaxBlockResultChars)
	default:
		raw, err := json.MarshalIndent(output, "", "  ")
		if err != nil {
			return ""
		}
		return CutRunes(string(raw), MaxBlockResultChars)
	}
}

// Accept field names used by different agents and CLI versions.
func FirstOf(report map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := report[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func AsBool(v any) bool {
	flag, _ := v.(bool)
	return flag
}

func AsInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case float32:
		return int64(n), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	case int32:
		return int64(n), true
	case json.Number:
		if parsed, err := n.Int64(); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func AsFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		if parsed, err := n.Float64(); err == nil {
			return parsed, true
		}
	}
	return 0, false
}
