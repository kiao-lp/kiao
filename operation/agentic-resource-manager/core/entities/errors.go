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

// OperationError carries an explanation suitable for a resource API response.
type OperationError struct {
	Message string
	Cause   error
}

func (e *OperationError) Error() string { return e.Message }
func (e *OperationError) Unwrap() error { return e.Cause }

func NotFoundf(format string, args ...any) error {
	return &OperationError{Message: fmt.Sprintf(format, args...), Cause: ErrNotFound}
}
func Invalidf(format string, args ...any) error {
	return &OperationError{Message: fmt.Sprintf(format, args...), Cause: ErrInvalid}
}
func Conflictf(format string, args ...any) error {
	return &OperationError{Message: fmt.Sprintf(format, args...), Cause: ErrConflict}
}

type DeletionStatus struct {
	NoRemote          bool   `json:"noRemote"`
	Dirty             bool   `json:"dirty"`
	Unpushed          bool   `json:"unpushed"`
	RemoteUnavailable bool   `json:"remoteUnavailable"`
	Confirmation      string `json:"confirmation"`
}
