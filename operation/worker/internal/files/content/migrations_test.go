package content

import (
	"fmt"
	"path/filepath"
	"testing"
)

func newMigrationSource(t *testing.T, id string, baseline int) string {
	t.Helper()
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "source.json"), fmt.Sprintf(`{"id":%q,"baseline":%d}`, id, baseline))
	return dir
}
