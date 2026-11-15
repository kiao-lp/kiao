package filesystem

import (
	"os"
	"syscall"
)

// AcquireLock takes an exclusive, non-blocking advisory lock on path using flock.
// The release closure drops the lock and closes the file.
func AcquireLock(path string) (release func(), locked bool, err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return func() {}, false, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if err == syscall.EWOULDBLOCK {
			return func() {}, false, nil
		}
		return func() {}, false, err
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, true, nil
}
