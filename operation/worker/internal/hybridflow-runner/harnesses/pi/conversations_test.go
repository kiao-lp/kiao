package pi

import (
	"kiao/worker/internal/hybridflow-runner/conversations"
	"testing"
)

// mustMessages replays a transcript.
func mustMessages(t *testing.T, store *conversations.ConversationStore, id string) []conversations.ConversationRecord {
	t.Helper()
	records, err := store.Messages(id)
	if err != nil {
		t.Fatalf("messages(%q) = %v", id, err)
	}
	return records
}
