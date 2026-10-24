//go:build !linux

package filesystem

// DiskUsage reports zeroes on non-Linux platforms.
func (s *Storage) DiskUsage() (total, free, usable int64) {
	return 0, 0, 0
}
