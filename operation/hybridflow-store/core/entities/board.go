// Package entities defines the hybridflow store domain.
package entities

import "time"

// Board is the aggregate root; flow nodes are written independently with their own
// revisions so concurrent edits to different flow nodes do not conflict.
type Board struct {
	ID   string
	Name string
	// Slug is the unique public URL handle, derived from the name and surviving re-import.
	Slug      string
	CreatedAt time.Time
	UpdatedAt time.Time
	Revision  int64
	// ArchivedAt is zero for a live board. Boards are never deleted automatically.
	ArchivedAt time.Time
	FolderID   string
}

func (b *Board) Archived() bool { return !b.ArchivedAt.IsZero() }
