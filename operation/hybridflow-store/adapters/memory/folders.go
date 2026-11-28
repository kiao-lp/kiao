package memory

import (
	"context"
	"sort"
	"strings"
	"time"

	"kiao/hybridflow-store/core/entities"
)

func (f *Store) ListFolders(_ context.Context, scope entities.FolderScope) ([]entities.Folder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]entities.Folder, 0, len(f.folders[scope]))
	for _, folder := range f.folders[scope] {
		out = append(out, folder)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

func (f *Store) CreateFolder(_ context.Context, scope entities.FolderScope, folder entities.Folder) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	folders := f.folders[scope]
	if _, exists := folders[folder.ID]; exists {
		return entities.Conflictf("folder %s already exists", folder.ID)
	}
	if err := checkFolderName(folders, folder.ID, folder.Name); err != nil {
		return err
	}
	if folders == nil {
		folders = make(map[string]entities.Folder)
		f.folders[scope] = folders
	}
	folders[folder.ID] = folder
	return nil
}

func (f *Store) RenameFolder(_ context.Context, scope entities.FolderScope, id, name string) (*entities.Folder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	folders := f.folders[scope]
	folder, exists := folders[id]
	if !exists {
		return nil, entities.NotFoundf("folder %s", id)
	}
	if err := checkFolderName(folders, id, name); err != nil {
		return nil, err
	}
	folder.Name = name
	folders[id] = folder
	return &folder, nil
}

func checkFolderName(folders map[string]entities.Folder, id, name string) error {
	for _, folder := range folders {
		if folder.ID != id && strings.EqualFold(folder.Name, name) {
			return entities.Conflictf("a folder with that name already exists")
		}
	}
	return nil
}

func (f *Store) DeleteFolder(_ context.Context, scope entities.FolderScope, id, actor string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	folders := f.folders[scope]
	if _, exists := folders[id]; !exists {
		return entities.NotFoundf("folder %s", id)
	}
	delete(folders, id)
	if scope == entities.BoardFolderScope {
		for _, board := range f.boards {
			if board.FolderID == id {
				board.FolderID = ""
				board.UpdatedAt = time.Now()
				board.Revision++
				f.record(entities.ScopeBoard, entities.ChangeUpdated, board.ID, "", actor, board.Revision)
			}
		}
	}
	return nil
}
