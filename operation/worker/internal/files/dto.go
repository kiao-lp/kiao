package files

// Keep the JSON contract in sync with PROTOCOL.md and reference/npm/kiao-worker types.

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

type ReindexRequestDto struct {
	Paths []string `json:"paths"`
}

// Indexed lists index-file paths, not source documents. UpToDate includes manual indexes,
// which must never be overwritten.
type ReindexResultDto struct {
	Indexed   []string            `json:"indexed"`
	UpToDate  int                 `json:"upToDate"`
	Failed    []ReindexFailureDto `json:"failed"`
	Truncated bool                `json:"truncated"`
}

type ReindexFailureDto struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// StagingDto names an empty store directory hidden from listings and discarded after review.
// Clients use its path with /upload, /reindex and /moveBatch.
type StagingDto struct {
	Path string `json:"path"`
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

// Ranges are [start, end) offsets in UTF-16 code units within Content, for browser slicing.
type SearchMatch struct {
	Line    int      `json:"line"`
	Content string   `json:"content"`
	Ranges  [][2]int `json:"ranges,omitempty"`
}

// Matches is empty for name-only hits, including binary and oversized files.
type SearchDto struct {
	File    string        `json:"file"`
	Matches []SearchMatch `json:"matches"`
}

// Truncated means the walk reached maxSearchResults files.
type SearchResponseDto struct {
	Results   []SearchDto `json:"results"`
	Truncated bool        `json:"truncated"`
}

type GitFileDto struct {
	Path       string  `json:"path"`
	OldPath    *string `json:"oldPath"`
	Index      string  `json:"index"`
	Worktree   string  `json:"worktree"`
	Staged     bool    `json:"staged"`
	Unstaged   bool    `json:"unstaged"`
	Untracked  bool    `json:"untracked"`
	Conflicted bool    `json:"conflicted"`
}

type GitStatusDto struct {
	Repo bool `json:"repo"`
	// Root is store-relative ("" for the store itself); Files paths are relative to Root.
	Root        string       `json:"root"`
	Branch      string       `json:"branch"`
	Upstream    string       `json:"upstream"`
	HasUpstream bool         `json:"hasUpstream"`
	Ahead       int          `json:"ahead"`
	Behind      int          `json:"behind"`
	Files       []GitFileDto `json:"files"`
}

type GitResultDto struct {
	Ok     bool   `json:"ok"`
	Output string `json:"output"`
}

type GitBranchDto struct {
	// Remote-tracking name ("origin/x") if no local counterpart exists.
	Name    string `json:"name"`
	Remote  bool   `json:"remote"`
	Current bool   `json:"current"`
}

type GitBranchesDto struct {
	Current  string         `json:"current"`
	Branches []GitBranchDto `json:"branches"`
}

type GitPathsRequestDto struct {
	Paths []string `json:"paths"`
}

type LinkFixSubstitution struct {
	LineNumber int    `json:"lineNumber"`
	OldValue   string `json:"oldValue"`
	NewValue   string `json:"newValue"`
}

type LinkFixFileChange struct {
	FilePath      string                `json:"filePath"`
	Substitutions []LinkFixSubstitution `json:"substitutions"`
}

type LinkFixReport struct {
	Operation    string              `json:"operation"` // "RENAME" | "DELETE"
	OriginalPath string              `json:"originalPath"`
	NewPath      *string             `json:"newPath"` // null on DELETE
	FileChanges  []LinkFixFileChange `json:"fileChanges"`
}


// Applicability fields are optional and AND-ed; an empty rule matches any entry.
type ActionAppliesToDto struct {
	// Case-insensitive filename suffixes, e.g. ".ttst.md".
	Extensions []string `json:"extensions,omitempty"`
	Directory *bool `json:"directory,omitempty"`
}

// Type is "string", "boolean" or "enum"; Values is required and meaningful only for "enum".
type ActionParamDto struct {
	Name    string   `json:"name"`
	Label   string   `json:"label,omitempty"`
	Type    string   `json:"type"`
	Values  []string `json:"values,omitempty"`
	Default any      `json:"default,omitempty"`
}

// Provider URLs stay server-side in registeredAction (actions.go); clients invoke actions by ID.
type ActionDto struct {
	ID        string             `json:"id"`
	Label     string             `json:"label"`
	Group     string             `json:"group,omitempty"`
	Order     int                `json:"order,omitempty"`
	AppliesTo ActionAppliesToDto `json:"appliesTo"`
	Params    []ActionParamDto   `json:"params,omitempty"`
}

type RunActionRequestDto struct {
	ID     string         `json:"id"`
	Path   string         `json:"path"`
	Params map[string]any `json:"params,omitempty"`
}

// ChangedPaths lets clients refresh what the action touched.
type ActionResultDto struct {
	OK           bool     `json:"ok"`
	Message      string   `json:"message"`
	ChangedPaths []string `json:"changedPaths"`
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
	Kept      string          `json:"kept"`
	Removed   []string        `json:"removed"`
	LinkFixes []LinkFixReport `json:"linkFixes"`
}

// Segments are saved as separate files beside the source.
type SaveSegmentsRequestDto struct {
	Path     string       `json:"path"`
	Segments []SegmentDto `json:"segments"`
}

// Name excludes the extension. Bounds span the first frame start to the last frame end,
// in fractional milliseconds.
type SegmentDto struct {
	Name   string  `json:"name"`
	FromMs float64 `json:"fromMs"`
	ToMs   float64 `json:"toMs"`
}

// A stopped save is not a failure.
const (
	MediaJobRunning = "running"
	MediaJobDone    = "done"
	MediaJobFailed  = "failed"
	MediaJobStopped = "stopped"
)

type MediaJobDto struct {
	ID    string `json:"id"`
	Path  string `json:"path"`
	State string `json:"state"`
	// Files lists output store paths in write order; Done counts completed files, Current is in progress.
	Files   []string `json:"files"`
	Done    int      `json:"done"`
	Current string   `json:"current,omitempty"`
	// Progress is 0–1 across the save, weighted by encoded duration.
	Progress  float64 `json:"progress"`
	Error     string  `json:"error,omitempty"`
	StartedAt string  `json:"startedAt"`
	EndedAt   string  `json:"endedAt,omitempty"`
}
