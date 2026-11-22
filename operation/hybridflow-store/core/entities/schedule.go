package entities

import (
	"regexp"
	"strings"
	"time"
)

// Durations use positive h/m/s/ms components, up to Go's time.Duration limit.
var durationShape = regexp.MustCompile(`^(?:[0-9]+(?:\.[0-9]+)?(?:ms|s|m|h))+$`)

func ReadDuration(raw string) string {
	said := strings.TrimSpace(raw)
	if !durationShape.MatchString(said) {
		return ""
	}
	duration, err := time.ParseDuration(said)
	if err != nil || duration <= 0 {
		return ""
	}
	return said
}

func ValidateSchedule(at, duration string) error {
	if strings.TrimSpace(at) != "" && strings.TrimSpace(duration) != "" {
		return Invalidf("a Scheduler uses either a datetime or a duration, not both")
	}
	if strings.TrimSpace(duration) != "" && ReadDuration(duration) == "" {
		return Invalidf("duration must be positive, such as 30s, 15m or 1h30m")
	}
	return nil
}

// Naming a nonempty alternative switches modes in the same write.
func NormalizeSchedulePatch(at, duration **string) error {
	var a, d string
	if *at != nil {
		a = **at
	}
	if *duration != nil {
		d = **duration
	}
	if err := ValidateSchedule(a, d); err != nil {
		return err
	}
	if *at != nil {
		a = ReadSchedule(a)
		*at = &a
	}
	if *duration != nil {
		d = ReadDuration(d)
		*duration = &d
	}
	empty := ""
	if a != "" {
		*duration = &empty
	}
	if d != "" {
		*at = &empty
	}
	return nil
}
