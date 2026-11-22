package entities

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrInvalid        = errors.New("invalid")
	ErrConflict       = errors.New("conflict")
	ErrAgentNameTaken = errors.New("agent name is taken")
)

func NotFoundf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrNotFound)
}
func Invalidf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrInvalid)
}
func Conflictf(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrConflict)
}

type DeletionStatus struct {
	NoRemote          bool   `json:"noRemote"`
	Dirty             bool   `json:"dirty"`
	Unpushed          bool   `json:"unpushed"`
	RemoteUnavailable bool   `json:"remoteUnavailable"`
	Confirmation      string `json:"confirmation"`
}
