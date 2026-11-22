package faults

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Subscription windows can last a month; reject implausibly distant reset times.
const RefreshCeiling = 32 * 24 * time.Hour

var (
	limitTimestampRe = regexp.MustCompile(`(?i)\b(?:resets?|try again)\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b`)
	limitEpochRe     = regexp.MustCompile(`\|\s*(\d{9,14})\b`)
	limitHTTPDateRe  = regexp.MustCompile(`(?i)\bretry[ _-]?after[:\s]+([A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)`)
	limitDateRe      = regexp.MustCompile(`(?i)\btry again at\s+([A-Za-z]{3} \d{1,2}(?:st|nd|rd|th)?, \d{4} \d{1,2}:\d{2}\s*[AP]M)`)
	limitOrdinalRe   = regexp.MustCompile(`(?i)(\d)(st|nd|rd|th)`)
	limitClockRe     = regexp.MustCompile(`(?i)\bresets?\s+(?:on\s+)?` +
		`(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?,?\s+)?` +
		`(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?\b` +
		`(?:\s*\(([A-Za-z]+(?:/[A-Za-z0-9_+-]+)*)\))?`)
	limitDelayRe = regexp.MustCompile(`(?i)\b(?:retry[ _-]?after|try again in)\b[:\s]*` +
		`((?:\d+(?:\.\d+)?\s*(?:milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*)+|\d+)\b`)
	limitDurationPartRe = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*([a-z]+)`)
)

type limitResetMoment struct {
	at         time.Time
	start, end int
	label      string
}

func LimitResetAt(notice string, now time.Time) (time.Time, bool) {
	reset, ok := readLimitReset(notice, now)
	return reset.at, ok
}

// Resolve provider clocks and delays once, so persisted notices and the scheduler name one instant.
// Dashboard formats these timestamps in the reader's locale and timezone.
func AbsoluteLimitNotice(notice string, now time.Time) string {
	fault := FailureFault(notice, "")
	if fault == nil || !fault.Limit {
		return notice
	}
	reset, ok := readLimitReset(notice, now)
	if !ok {
		return notice
	}
	return notice[:reset.start] + reset.label + reset.at.UTC().Format(time.RFC3339Nano) + notice[reset.end:]
}

func readLimitReset(notice string, now time.Time) (limitResetMoment, bool) {
	for _, reader := range []func(string, time.Time) (limitResetMoment, bool){
		readLimitTimestamp, readLimitEpoch, readLimitHTTPDate, readLimitDate, readLimitClock, readLimitDelay,
	} {
		if reset, ok := reader(notice, now); ok {
			if reset.at.Sub(now) > RefreshCeiling {
				return limitResetMoment{}, false
			}
			return reset, true
		}
	}
	return limitResetMoment{}, false
}

func readLimitTimestamp(notice string, _ time.Time) (limitResetMoment, bool) {
	match := limitTimestampRe.FindStringSubmatchIndex(notice)
	if match == nil {
		return limitResetMoment{}, false
	}
	at, err := time.Parse(time.RFC3339Nano, notice[match[2]:match[3]])
	label := "resets at "
	if strings.HasPrefix(strings.ToLower(notice[match[0]:]), "try again") {
		label = "try again at "
	}
	return limitResetMoment{at, match[0], match[1], label}, err == nil
}

func readLimitEpoch(notice string, _ time.Time) (limitResetMoment, bool) {
	match := limitEpochRe.FindStringSubmatchIndex(notice)
	if match == nil {
		return limitResetMoment{}, false
	}
	value, err := strconv.ParseInt(notice[match[2]:match[3]], 10, 64)
	at := time.Unix(value, 0)
	if value > 1e11 {
		at = time.UnixMilli(value)
	}
	return limitResetMoment{at, match[0], match[1], " · resets at "}, err == nil
}

func readLimitHTTPDate(notice string, _ time.Time) (limitResetMoment, bool) {
	match := limitHTTPDateRe.FindStringSubmatchIndex(notice)
	if match == nil {
		return limitResetMoment{}, false
	}
	at, err := http.ParseTime(notice[match[2]:match[3]])
	return limitResetMoment{at, match[0], match[1], "try again at "}, err == nil
}

func readLimitDate(notice string, _ time.Time) (limitResetMoment, bool) {
	match := limitDateRe.FindStringSubmatchIndex(notice)
	if match == nil {
		return limitResetMoment{}, false
	}
	date := limitOrdinalRe.ReplaceAllString(notice[match[2]:match[3]], "$1")
	at, err := time.ParseInLocation("Jan 2, 2006 3:04 PM", date, time.Local)
	return limitResetMoment{at, match[0], match[1], "try again at "}, err == nil
}

// A wall clock must end at a boundary: the year in an ISO date is never an hour.
func readLimitClock(notice string, now time.Time) (limitResetMoment, bool) {
	indices := limitClockRe.FindStringSubmatchIndex(notice)
	if indices == nil || (indices[1] < len(notice) && strings.ContainsRune(":-+", rune(notice[indices[1]]))) {
		return limitResetMoment{}, false
	}
	match := limitClockRe.FindStringSubmatch(notice)
	hour, _ := strconv.Atoi(match[2])
	minute, _ := strconv.Atoi(match[3])
	second, _ := strconv.Atoi(match[4])
	meridiem := strings.ToLower(match[5])
	if hour > 23 || minute > 59 || second > 59 || (meridiem != "" && (hour < 1 || hour > 12)) {
		return limitResetMoment{}, false
	}
	if meridiem == "pm" && hour < 12 {
		hour += 12
	} else if meridiem == "am" && hour == 12 {
		hour = 0
	}
	zone := time.Local
	if match[6] != "" {
		var err error
		zone, err = time.LoadLocation(match[6])
		if err != nil {
			return limitResetMoment{}, false
		}
	}
	here := now.In(zone)
	at := time.Date(here.Year(), here.Month(), here.Day(), hour, minute, second, 0, zone)
	if !at.After(now) {
		at = at.AddDate(0, 0, 1)
	}
	if match[1] != "" {
		weekday := limitWeekdays[strings.ToLower(match[1][:3])]
		for at.Weekday() != weekday {
			at = at.AddDate(0, 0, 1)
		}
	}
	return limitResetMoment{at, indices[0], indices[1], "resets at "}, true
}

var limitWeekdays = map[string]time.Weekday{
	"mon": time.Monday, "tue": time.Tuesday, "wed": time.Wednesday, "thu": time.Thursday,
	"fri": time.Friday, "sat": time.Saturday, "sun": time.Sunday,
}

func readLimitDelay(notice string, now time.Time) (limitResetMoment, bool) {
	match := limitDelayRe.FindStringSubmatchIndex(notice)
	if match == nil {
		return limitResetMoment{}, false
	}
	delay := strings.TrimSpace(notice[match[2]:match[3]])
	parts := limitDurationPartRe.FindAllStringSubmatch(delay, -1)
	var duration time.Duration
	if len(parts) == 0 {
		rest := strings.TrimSpace(notice[match[3]:])
		if rest != "" && ((rest[0] >= 'a' && rest[0] <= 'z') || (rest[0] >= 'A' && rest[0] <= 'Z')) {
			return limitResetMoment{}, false
		}
		seconds, err := strconv.ParseInt(delay, 10, 64)
		if err != nil || seconds > int64(RefreshCeiling/time.Second) {
			return limitResetMoment{}, false
		}
		duration = time.Duration(seconds) * time.Second
	}
	for _, part := range parts {
		value, err := strconv.ParseFloat(part[1], 64)
		unit := time.Second
		switch word := strings.ToLower(part[2]); {
		case word == "ms" || strings.HasPrefix(word, "millisecond"):
			unit = time.Millisecond
		case strings.HasPrefix(word, "m"):
			unit = time.Minute
		case strings.HasPrefix(word, "h"):
			unit = time.Hour
		case strings.HasPrefix(word, "d"):
			unit = 24 * time.Hour
		}
		if err != nil || value > float64(RefreshCeiling)/float64(unit) {
			return limitResetMoment{}, false
		}
		duration += time.Duration(value * float64(unit))
	}
	return limitResetMoment{now.Add(duration), match[0], match[2] + len(delay), "try again at "}, true
}
