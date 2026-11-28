package entities

import (
	"regexp"
	"strings"
)

var commitIDShape = regexp.MustCompile(`^([A-Za-z0-9_-]+/[A-Za-z0-9_-][A-Za-z0-9_.-]*@)?[a-fA-F0-9]{7,40}$`)

func ReadCommitID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id == "" || commitIDShape.MatchString(id) || nodeContextReference.MatchString(id) {
		return id, nil
	}
	return "", Invalidf("commit ID must be a Git hash, workspace/repository@hash or a value reference")
}

func ReadCommitStatus(raw string) (string, error) {
	status := strings.TrimSpace(raw)
	if nodeContextReference.MatchString(status) {
		return status, nil
	}
	status = strings.ToUpper(status)
	switch status {
	case "", "INPROGRESS", "SUCCESSFUL", "FAILED", "STOPPED":
		return status, nil
	default:
		return "", Invalidf("commit status must be INPROGRESS, SUCCESSFUL, FAILED, STOPPED or a value reference")
	}
}
