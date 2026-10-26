package search

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
