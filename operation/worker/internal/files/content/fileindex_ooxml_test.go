package content

import (
	"archive/zip"
	"bytes"
	"io"
	"sort"
	"testing"
)

// mustWriteZipDoc writes a zip container at path holding the given entry name -> content. Every
// zip+XML format (.docx, .xlsx, .xlsm, .pptx, .odt, .ods) is built this way, so the suite needs
// no committed binary fixtures.
func mustWriteZipDoc(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// Deterministic entry order, so a test never depends on map iteration.
	names := make([]string, 0, len(entries))
	for n := range entries {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, entries[n]); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	mustWriteBytes(t, path, buf.Bytes())
}
