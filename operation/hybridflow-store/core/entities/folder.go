package entities

// FolderScope identifies a collection that can be organized into folders.
type FolderScope string

const BoardFolderScope FolderScope = "boards"

type Folder struct {
	ID   string
	Name string
}
