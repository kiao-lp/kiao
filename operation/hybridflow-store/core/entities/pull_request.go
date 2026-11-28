package entities

import (
	"regexp"
	"strings"
)

var pullRequestIDShape = regexp.MustCompile(`^([A-Za-z0-9_-]+/[A-Za-z0-9_-][A-Za-z0-9_.-]*#)?[1-9][0-9]*$`)

func ReadPullRequestID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id == "" || pullRequestIDShape.MatchString(id) || nodeContextReference.MatchString(id) {
		return id, nil
	}
	return "", Invalidf("pull request ID must be a positive number, workspace/repository#number or a value reference")
}

func ReadPullRequestStatus(raw string) (string, error) {
	status := strings.TrimSpace(raw)
	if nodeContextReference.MatchString(status) {
		return status, nil
	}
	status = strings.ToUpper(status)
	switch status {
	case "", "OPEN", "MERGED", "DECLINED", "SUPERSEDED":
		return status, nil
	default:
		return "", Invalidf("pull request status must be OPEN, MERGED, DECLINED, SUPERSEDED or a value reference")
	}
}
