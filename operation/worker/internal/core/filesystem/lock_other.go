//go:build !linux

package filesystem

import "os"

// AcquireLock is a best-effort no-op lock on non-Linux platforms (the deployment target is
// Linux). It only ensures the lock file exists so the contract matches.
func AcquireLock(path string) (release func(), locked bool, err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return func() {}, false, err
	}
	return func() { f.Close() }, true, nil
}
