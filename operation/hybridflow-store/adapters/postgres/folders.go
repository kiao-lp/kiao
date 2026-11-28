package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

type FolderStore struct {
	pool *pgxpool.Pool
}

func NewFolderStore(pool *pgxpool.Pool) *FolderStore { return &FolderStore{pool: pool} }

var _ ports.FolderRepository = (*FolderStore)(nil)

func (s *FolderStore) ListFolders(ctx context.Context, scope entities.FolderScope) ([]entities.Folder, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name FROM folder WHERE scope = $1 ORDER BY lower(name)`, scope)
	if err != nil {
		return nil, translate(err, "the folders")
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[entities.Folder])
}

func (s *FolderStore) CreateFolder(ctx context.Context, scope entities.FolderScope, folder entities.Folder) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO folder (scope, id, name) VALUES ($1, $2, $3)`,
		scope, folder.ID, folder.Name)
	return translate(err, fmt.Sprintf("folder %q", folder.Name))
}

func (s *FolderStore) RenameFolder(ctx context.Context, scope entities.FolderScope, id, name string) (*entities.Folder, error) {
	var folder entities.Folder
	err := s.pool.QueryRow(ctx, `
		UPDATE folder SET name = $3 WHERE scope = $1 AND id::text = $2 RETURNING id, name`,
		scope, id, name).Scan(&folder.ID, &folder.Name)
	if err != nil {
		return nil, translate(err, fmt.Sprintf("folder %s", id))
	}
	return &folder, nil
}

func (s *FolderStore) DeleteFolder(ctx context.Context, scope entities.FolderScope, id, actor string) error {
	// Detaching boards through the foreign key also records their changes.
	return inTx(ctx, s.pool, actor, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM folder WHERE scope = $1 AND id::text = $2`, scope, id)
		if err != nil {
			return translate(err, fmt.Sprintf("folder %s", id))
		}
		if tag.RowsAffected() == 0 {
			return entities.NotFoundf("folder %s", id)
		}
		return nil
	})
}
