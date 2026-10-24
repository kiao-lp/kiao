package protocol

func AsString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func OrDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
