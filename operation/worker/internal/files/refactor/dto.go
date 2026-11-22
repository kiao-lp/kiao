package refactor

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
