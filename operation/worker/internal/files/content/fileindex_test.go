package content

import (
	"kiao/worker/internal/files/search"
	"testing"
)

// TestSubsidiarySuffixesCoverEveryIndexFormat is what keeps a new index format from becoming a
// file of its own: a suffix missing here shows up in listings and outlives its document.
func TestSubsidiarySuffixesCoverEveryIndexFormat(t *testing.T) {
	for _, suffix := range search.IndexSuffixes {
		if matchedSuffix("doc.pdf"+suffix) != suffix {
			t.Errorf("index format %q is not a subsidiary suffix", suffix)
		}
	}
}
