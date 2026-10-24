package faults

import (
	"errors"
	"os"
)

// ClientError marks caller errors whose full wrapped message may be exposed.
// Sentinels compare by identity through errors.Is.
type ClientError struct{ msg string }

func (e *ClientError) Error() string { return e.msg }

// Invalid declares a caller-error sentinel without registration.
func Invalid(msg string) *ClientError { return &ClientError{msg: msg} }

// ClientMessage hides unclassified failures while retaining actionable caller errors.
func ClientMessage(err error) string {
	var client *ClientError
	if errors.As(err, &client) || errors.Is(err, os.ErrNotExist) {
		return err.Error()
	}
	return "internal error"
}
