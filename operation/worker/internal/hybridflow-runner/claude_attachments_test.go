package hybridflowrunner

import (
	"bytes"
	"encoding/json"
	"kiao/worker/internal/core"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newAttachmentTestServer builds a Service wired for the attachment endpoints only, over a state
// directory of its own.
func newAttachmentTestServer(t *testing.T) (*Service, *AttachmentStore) {
	t.Helper()
	cfg := &Config{Config: &core.Config{AuthMode: "debug", RootPath: t.TempDir(), StatePath: t.TempDir()}}
	store, err := newAttachmentStore(filepath.Join(cfg.StatePath, attachmentsDirName))
	if err != nil {
		t.Fatalf("newAttachmentStore: %v", err)
	}
	return &Service{cfg: cfg, attachments: store}, store
}

// uploadReq builds the multipart POST the browser sends for one attachment.
func uploadReq(filename string, body []byte) *http.Request {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", filename)
	_, _ = part.Write(body)
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, "/claude/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func TestSafeAttachmentName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"screenshot.png", "screenshot.png"},
		{"Capture d'écran 2026-08-25.png", "Capture-d-cran-2026-08-25.png"},
		{"../../etc/passwd", "passwd"},
		{`C:\Users\me\report.docx`, "report.docx"},
		{"a b   c.txt", "a-b-c.txt"},
		{"", "file"},
		{"...", "file"},
		{"—.png", "png"},
		{".hidden", "hidden"},
		{"rm -rf /; echo.sh", "echo.sh"},
	}
	for _, c := range cases {
		if got := safeAttachmentName(c.in); got != c.want {
			t.Errorf("safeAttachmentName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Whatever a name reduces to, the id it lands in has to be one resolve will take back — that is the
// only property that matters, since the id is a path segment.
func TestSafeAttachmentNameAlwaysMakesAValidID(t *testing.T) {
	names := []string{
		"", "...", "-", "日本語の文書.pdf", strings.Repeat("long", 60) + ".png",
		"..", "../..", "  ", "\t\n", strings.Repeat("é", 200),
	}
	store, err := newAttachmentStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		saved, err := store.save(name, strings.NewReader("x"))
		if err != nil {
			t.Fatalf("save(%q): %v", name, err)
		}
		if !attachmentIDRe.MatchString(saved.ID) {
			t.Errorf("save(%q) minted id %q, which resolve would refuse", name, saved.ID)
		}
		if filepath.Base(saved.Path) != saved.ID {
			t.Errorf("save(%q) stored at %q, outside the id it minted", name, saved.Path)
		}
	}
}

func TestAttachmentSaveAndResolve(t *testing.T) {
	store, err := newAttachmentStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.save("diagram.png", strings.NewReader("PNGDATA"))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.Name != "diagram.png" || saved.Size != 7 || saved.MediaType != "image/png" {
		t.Errorf("saved = %+v, want name diagram.png, size 7, image/png", saved)
	}
	if body := mustReadBytes(t, saved.Path); string(body) != "PNGDATA" {
		t.Errorf("stored bytes = %q, want PNGDATA", body)
	}

	found, err := store.resolve(saved.ID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if found != saved {
		t.Errorf("resolve = %+v, want the saved attachment %+v", found, saved)
	}
}

// The id is the one path segment a client supplies, so its shape is the traversal boundary.
func TestAttachmentResolveRefusesBadIDs(t *testing.T) {
	store, err := newAttachmentStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{
		"", "..", "../conversations/index.json", "att-1-aaaa-x.png",
		"att-1756100000000-zzzz-x.png", "att-1756100000000-aaaa-../x", "conv-1756100000000-aaaa",
		"att-1756100000000-aaaa-.hidden",
	} {
		if _, err := store.resolve(id); err == nil {
			t.Errorf("resolve(%q) succeeded; want a refusal", id)
		} else if status, _ := core.StatusForError(err); status != http.StatusBadRequest {
			t.Errorf("resolve(%q) → %d, want 400", id, status)
		}
	}
}

// A swept attachment is a 404 rather than a 400: the client is not wrong, the file has aged out.
func TestAttachmentResolveMissingIsNotFound(t *testing.T) {
	store, err := newAttachmentStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.resolve("att-1756100000000-abcd-gone.png")
	if err == nil {
		t.Fatal("resolve of an unknown id succeeded")
	}
	if status, _ := core.StatusForError(err); status != http.StatusNotFound {
		t.Errorf("status = %d, want 404", status)
	}
}

// A body that keeps coming past the cap must not fill the disk, and must leave nothing behind: a
// half-written image is worse than none, because a turn would report on it without knowing.
func TestAttachmentSaveRefusesOversizeAndLeavesNothing(t *testing.T) {
	dir := t.TempDir()
	store, err := newAttachmentStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	store.maxBytes = 16
	if _, err := store.save("big.bin", strings.NewReader(strings.Repeat("x", 17))); err == nil {
		t.Fatal("save of an oversize body succeeded")
	} else if status, _ := core.StatusForError(err); status != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", status)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("directory holds %d entries after a refused upload, want none", len(entries))
	}
	// Exactly at the cap is accepted: the refusal is for what exceeds it.
	if _, err := store.save("ok.bin", strings.NewReader(strings.Repeat("x", 16))); err != nil {
		t.Errorf("save at exactly the cap: %v", err)
	}
}

func TestAttachmentSweep(t *testing.T) {
	dir := t.TempDir()
	store, err := newAttachmentStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	old, err := store.save("old.png", strings.NewReader("a"))
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := store.save("fresh.png", strings.NewReader("b"))
	if err != nil {
		t.Fatal(err)
	}
	stale := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(old.Path, stale, stale); err != nil {
		t.Fatal(err)
	}
	// Something that is not an attachment shares the directory in no deployment, but the sweep is a
	// delete loop and must not be the thing that learns otherwise.
	mustWriteBytes(t, filepath.Join(dir, "notes.txt"), []byte("keep me"))

	if swept := store.sweep(24 * time.Hour); swept != 1 {
		t.Errorf("swept = %d, want 1", swept)
	}
	if _, err := os.Stat(old.Path); !os.IsNotExist(err) {
		t.Error("the expired attachment survived the sweep")
	}
	if _, err := os.Stat(fresh.Path); err != nil {
		t.Errorf("the fresh attachment was swept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes.txt")); err != nil {
		t.Errorf("the sweep removed a file that is not an attachment: %v", err)
	}
}

func TestUploadAndGetAttachmentEndpoints(t *testing.T) {
	srv, _ := newAttachmentTestServer(t)
	handler := srv.handler()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, uploadReq("Mon Écran.png", []byte("PNGBYTES")))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d (%s), want 201", rec.Code, rec.Body.String())
	}
	var dto AgentAttachmentDto
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("upload body: %v", err)
	}
	if dto.Name != "Mon-cran.png" || dto.MediaType != "image/png" || dto.Size != 8 {
		t.Errorf("dto = %+v, want the reduced name, image/png and 8 bytes", dto)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/claude/attachments/"+dto.ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "PNGBYTES" {
		t.Errorf("get body = %q, want PNGBYTES", body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
}

// The request cap is not the file cap: it stops an endless body from spilling into the temp
// directory before save() ever sees it. What the user is told about a merely-too-large file is
// save()'s refusal, which names a number.
func TestUploadRefusesAnOversizeBody(t *testing.T) {
	srv, store := newAttachmentTestServer(t)
	store.maxBytes = 32
	rec := httptest.NewRecorder()
	srv.handler().ServeHTTP(rec, uploadReq("big.bin", bytes.Repeat([]byte("x"), 64)))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d (%s), want 413", rec.Code, rec.Body.String())
	}
	entries, _ := os.ReadDir(store.dir)
	if len(entries) != 0 {
		t.Errorf("the attachment directory holds %d entries after a refusal, want none", len(entries))
	}
}

func TestGetAttachmentRefusesTraversal(t *testing.T) {
	srv, store := newAttachmentTestServer(t)
	mustWriteBytes(t, filepath.Join(filepath.Dir(store.dir), "secret.json"), []byte("{}"))
	handler := srv.handler()

	for _, id := range []string{"..%2Fsecret.json", "att-1-a-x", "not-an-id"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/claude/attachments/"+id, nil))
		if rec.Code == http.StatusOK {
			t.Errorf("GET /claude/attachments/%s = 200; want a refusal", id)
		}
	}
}

// The prompt is the only channel the CLI has, so what the model is told about an attachment is
// exactly what this function writes.
func TestPromptWithContextNamesTheAttachments(t *testing.T) {
	plain := promptWithContext("look at this", nil, nil)
	if strings.Contains(plain, "attached") {
		t.Errorf("a prompt with no attachments mentions them:\n%s", plain)
	}
	if plain != "look at this" {
		t.Errorf("a prompt with nothing handed to it was rewritten:\n%s", plain)
	}

	with := promptWithContext("look at this", []claudeAttachment{
		{ID: "att-1-aaaa-a.png", Name: "a.png", Size: 12, MediaType: "image/png", Path: "/state/a.png"},
		{ID: "att-1-bbbb-b.pdf", Name: "b.pdf", Size: 34, MediaType: "application/pdf", Path: "/state/b.pdf"},
	}, nil)
	for _, want := range []string{
		"look at this", "these files", "Read tool",
		"- /state/a.png (image/png, 12 bytes)", "- /state/b.pdf (application/pdf, 34 bytes)",
	} {
		if !strings.Contains(with, want) {
			t.Errorf("prompt is missing %q:\n%s", want, with)
		}
	}
	// The order is the user's, and "the first screenshot" has to mean what they meant by it.
	if strings.Index(with, "a.png") > strings.Index(with, "b.pdf") {
		t.Errorf("the attachments were reordered:\n%s", with)
	}
}

func TestPromptWithContextSingularForOneAttachment(t *testing.T) {
	one := promptWithContext("hi", []claudeAttachment{{Path: "/state/a.png", MediaType: "image/png"}}, nil)
	if !strings.Contains(one, "attached this file") {
		t.Errorf("one attachment is not described in the singular:\n%s", one)
	}
}

// A slash command is addressed to the CLI, and several of them take a free-text argument, so a note
// appended to one is read as that argument rather than as context. `/compact` is the one the flow
// nodes board sends between two flow nodes of a chain, and it must arrive as itself.
func TestPromptWithContextLeavesABareSlashCommandAlone(t *testing.T) {
	for _, prompt := range []string{"/compact", "  /clear  ", "/mcp"} {
		if got := promptWithContext(prompt, nil, nil); got != prompt {
			t.Errorf("promptWithContext(%q) = %q; want it untouched", prompt, got)
		}
	}
	for _, prompt := range []string{"/compact", "  /clear  "} {
		with := promptWithContext(prompt, []claudeAttachment{{Path: "/state/a.png", MediaType: "image/png", Size: 1}}, nil)
		if with != prompt {
			t.Errorf("a bare slash command with attachments was rewritten:\n%s", with)
		}
	}
}

// Only a bare one. Anything after the word is a message somebody wrote — an instruction to compact
// around, or a line of prose beginning with a path — and is told what it was handed like any other.
func TestPromptWithContextStillPlacesAPromptThatMerelyStartsWithASlash(t *testing.T) {
	for _, prompt := range []string{"/compact keep the plan", "/etc/hosts is the file to read", "//"} {
		if got := promptWithContext(prompt, nil, nil); got != prompt {
			t.Errorf("promptWithContext(%q) = %q; want it untouched when nothing was handed to it", prompt, got)
		}
		attached := promptWithContext(prompt, []claudeAttachment{{Path: "/state/a.png", MediaType: "image/png", Size: 1}}, nil)
		if !strings.Contains(attached, "attached this file") {
			t.Errorf("promptWithContext(%q) lost the attachment note:\n%s", prompt, attached)
		}
	}
}

// A prompt naming an attachment that is gone is refused, not run without it: a model answering
// about a screenshot it never saw is the one outcome neither side can detect.
func TestResolveAttachmentsRefusesWhatIsNotThere(t *testing.T) {
	store, err := newAttachmentStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	hub := &ClaudeHub{attachments: store}

	if got, err := hub.resolveAttachments(nil); err != nil || got != nil {
		t.Errorf("resolveAttachments(nil) = %v, %v; want nil, nil", got, err)
	}
	if _, err := hub.resolveAttachments([]string{"att-1756100000000-abcd-gone.png"}); err == nil {
		t.Error("a missing attachment was accepted")
	} else if !strings.Contains(err.Error(), "Attach it again") {
		t.Errorf("error = %q, which does not tell the user what to do", err)
	}

	saved, err := store.save("here.png", strings.NewReader("x"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := hub.resolveAttachments([]string{saved.ID})
	if err != nil {
		t.Fatalf("resolveAttachments: %v", err)
	}
	if len(got) != 1 || got[0].Path != saved.Path {
		t.Errorf("resolveAttachments = %+v, want the saved attachment", got)
	}

	// A hub with no attachment store refuses rather than silently dropping them.
	if _, err := (&ClaudeHub{}).resolveAttachments([]string{saved.ID}); err == nil {
		t.Error("a hub with no attachment store accepted an attachment")
	}
}
