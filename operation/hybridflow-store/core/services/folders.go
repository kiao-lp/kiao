package services

import (
	"context"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Folders manages classification folders for one collection.
type Folders struct {
	scope entities.FolderScope
	repo  ports.FolderRepository
	ids   ports.IDs
}

func NewFolders(scope entities.FolderScope, repo ports.FolderRepository, ids ports.IDs) *Folders {
	return &Folders{scope: scope, repo: repo, ids: ids}
}

func (f *Folders) List(ctx context.Context) ([]entities.Folder, error) {
	return f.repo.ListFolders(ctx, f.scope)
}

func (f *Folders) Create(ctx context.Context, name string) (*entities.Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, entities.Invalidf("a folder needs a name")
	}
	folder := entities.Folder{ID: f.ids.NewID(), Name: name}
	if err := f.repo.CreateFolder(ctx, f.scope, folder); err != nil {
		return nil, err
	}
	return &folder, nil
}

func (f *Folders) Rename(ctx context.Context, id, name string) (*entities.Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, entities.Invalidf("a folder needs a name")
	}
	return f.repo.RenameFolder(ctx, f.scope, id, name)
}

func (f *Folders) Delete(ctx context.Context, id, actor string) error {
	return f.repo.DeleteFolder(ctx, f.scope, id, actor)
}
