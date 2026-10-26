package filesystem

import (
	"syscall"
)

// DiskUsage reports total/free/usable bytes for the filesystem holding the storage root,
// mirroring java.nio.file.FileStore (getTotalSpace / getUnallocatedSpace / getUsableSpace).
func (s *Storage) DiskUsage() (total, free, usable int64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(s.Root, &st); err != nil {
		return 0, 0, 0
	}
	bsize := int64(st.Bsize)
	return int64(st.Blocks) * bsize, // total
		int64(st.Bfree) * bsize, // unallocated
		int64(st.Bavail) * bsize // usable by unprivileged users
}
