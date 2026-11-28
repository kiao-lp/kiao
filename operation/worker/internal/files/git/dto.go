package git

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
	// Root is the Git worktree path relative to the DCMS root. It is empty for a worktree at
	// or above the DCMS root. Files paths are relative to the Git worktree.
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
