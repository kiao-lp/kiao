package entities

import (
	"regexp"
	"strings"
)

const roleIDPattern = `[A-Za-z0-9_-]+`

var roleIDShape = regexp.MustCompile(`^` + roleIDPattern + `$`)

type RoleKind string

const (
	RoleKindHuman RoleKind = "human"
	RoleKindAgent RoleKind = "agent"
)

func ReadRoleKind(kind RoleKind) (RoleKind, error) {
	switch kind {
	case "", RoleKindHuman:
		return RoleKindHuman, nil
	case RoleKindAgent:
		return RoleKindAgent, nil
	default:
		return "", Invalidf("role kind %q must be human or agent", kind)
	}
}

func ReadRoleID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id != "" && !roleIDShape.MatchString(id) {
		return "", Invalidf("a role ID can only contain letters, digits, underscores and hyphens")
	}
	return id, nil
}

func ReadRolePeople(lines []string) ([]string, error) {
	people := make([]string, 0, len(lines))
	for _, line := range lines {
		person := strings.TrimSpace(line)
		if strings.ContainsAny(person, "\r\n") {
			return nil, Invalidf("each person must be on a single line")
		}
		if person != "" {
			people = append(people, person)
		}
	}
	return people, nil
}
