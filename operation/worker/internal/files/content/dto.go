package content

import (
	"kiao/worker/internal/files/refactor"
)

type FileCompanionDto struct {
	Name   string `json:"name"`
	Suffix string `json:"suffix"` // empty string for the main file
	Exists bool   `json:"exists"`
}

type FileDto struct {
	Path          string             `json:"path"`
	IsDirectory   bool               `json:"isDirectory"`
	Size          int64              `json:"size"`
	LastModified  int64              `json:"lastModified"`
	ChildrenCount *int               `json:"childrenCount"` // null for files
	Indexed       bool               `json:"indexed"`
	Companions    []FileCompanionDto `json:"companions"`
}

type DeleteBatchRequestDto struct {
	Paths []string `json:"paths"`
}

// StagingDto names an empty store directory hidden from listings and discarded after review.
// Clients use its path with /upload, /reindex and /moveBatch.
type StagingDto struct {
	Path string `json:"path"`
}

// Extracted lists the store-relative paths of the files an unzip wrote, in archive order.
type UnzipResultDto struct {
	Extracted []string `json:"extracted"`
}

type MoveItemDto struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type MoveBatchRequestDto struct {
	Paths        []string      `json:"paths,omitempty"`
	TargetFolder string        `json:"targetFolder,omitempty"`
	Items        []MoveItemDto `json:"items,omitempty"`
}

// CopyBatchRequestDto accepts Paths with TargetFolder, or explicit from/to Items.
type CopyBatchRequestDto struct {
	Paths        []string      `json:"paths,omitempty"`
	TargetFolder string        `json:"targetFolder,omitempty"`
	Items        []MoveItemDto `json:"items,omitempty"`
}

// To is the destination after collision resolution, including any server-chosen " (copy)" name.
type CopyResultDto struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Space figures follow java.nio.file.FileStore semantics.
type DiskUsageDto struct {
	TotalSpace  int64 `json:"totalSpace"`
	FreeSpace   int64 `json:"freeSpace"`
	UsableSpace int64 `json:"usableSpace"`
}

// RootPath is the absolute host path; prepend it to store-relative paths for local tools.
type StoreInfoDto struct {
	RootPath string `json:"rootPath"`
}

// /listRecursive reports the scope of a deletion. Truncated means a cap or an excluded
// folder stopped the walk; excluded folders are listed without counting their contents.
type ScopeResponseDto struct {
	Files     []FileDto `json:"files"`
	Truncated bool      `json:"truncated"`
}

// Duplicates are verified by content, not just size. Wasted = size × (copies − 1),
// and determines group sort order.
type DuplicateGroupDto struct {
	Hash   string    `json:"hash"`
	Size   int64     `json:"size"`
	Wasted int64     `json:"wasted"`
	Files  []FileDto `json:"files"`
}

// Scanned counts files considered; Truncated means a cap or exclusion stopped the walk.
type FileOptimizationsDto struct {
	Duplicates []DuplicateGroupDto `json:"duplicates"`
	Largest    []FileDto           `json:"largest"`
	Scanned    int                 `json:"scanned"`
	Truncated  bool                `json:"truncated"`
}

// Target may be any path the service is permitted to write.
type DeduplicateRequestDto struct {
	Paths  []string `json:"paths"`
	Target string   `json:"target"`
}

// Consolidation moves every copy onto Kept and repairs references to all copies.
type DeduplicateResultDto struct {
	Kept      string                   `json:"kept"`
	Removed   []string                 `json:"removed"`
	LinkFixes []refactor.LinkFixReport `json:"linkFixes"`
}
