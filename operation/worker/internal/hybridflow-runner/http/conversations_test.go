package runnerhttp

import (
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	"path/filepath"
	"testing"
)

// mustMessages replays a transcript.
func mustMessages(t *testing.T, store *pkgConversations.ConversationStore, id string) []pkgConversations.ConversationRecord {
	t.Helper()
	records, err := store.Messages(id)
	if err != nil {
		t.Fatalf("messages(%q) = %v", id, err)
	}
	return records
}

// newTestConversationStore builds a store over a state directory of its own. Every test in this file
// and in handlers_conversations_test.go goes through it, so the two agree on what a store is.
func newTestConversationStore(t *testing.T) *pkgConversations.ConversationStore {
	t.Helper()
	store, err := pkgConversations.NewConversationStore(filepath.Join(t.TempDir(), pkgConversations.ConversationsDirName))
	if err != nil {
		t.Fatalf("newConversationStore: %v", err)
	}
	return store
}

// mustCreate creates a conversation and fails the test if the store refused, so the tests that are
// about something else are not written twice.
func mustCreate(t *testing.T, store *pkgConversations.ConversationStore, folder string) pkgConversations.ConversationMeta {
	t.Helper()
	meta, err := store.Create(pkgConversations.ConversationMeta{Folder: folder})
	if err != nil {
		t.Fatalf("create(%q) = %v", folder, err)
	}
	return meta
}

// mustAppend writes one transcript record, which is what one half of a turn boundary does.
func mustAppend(t *testing.T, store *pkgConversations.ConversationStore, id string, rec pkgConversations.ConversationRecord,
	mutate func(*pkgConversations.ConversationMeta)) pkgConversations.ConversationMeta {
	t.Helper()
	meta, err := store.AppendAndUpdate(id, rec, mutate)
	if err != nil {
		t.Fatalf("appendAndUpdate(%q) = %v", id, err)
	}
	return meta
}
