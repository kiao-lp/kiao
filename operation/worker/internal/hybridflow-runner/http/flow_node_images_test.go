package runnerhttp

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	pkgConversations "kiao/worker/internal/hybridflow-runner/conversations"
	pkgTurns "kiao/worker/internal/hybridflow-runner/turns"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFlowNodeImageLinksTakesEmbedsAndImageLinks(t *testing.T) {
	body := "An embed: ![shot](shot.png)\n" +
		"A link to a picture: [mockup](/design/mockup.jpeg)\n" +
		"A link to a document: [the plan](/docs/plan.md)\n"

	got := pkgBoards.FlowNodeImageLinks(body)
	want := []string{"shot.png", "/design/mockup.jpeg"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("links = %v, want %v", got, want)
	}
}

// Every one of these names something that is not a file of this store, or names it twice.
func TestFlowNodeImageLinksLeavesOutWhatIsNotAStoreImage(t *testing.T) {
	body := "![badge](https://img.shields.io/build.svg)\n" +
		"![inline](data:image/png;base64,AAAA)\n" +
		"[a page](https://example.com/a.png)\n" +
		"![shot](shot.png) and again ![the same](shot.png)\n" +
		"```\n![in a fence](fenced.png)\n```\n" +
		"~~~markdown\n![in a tilde fence](tilde.png)\n~~~\n"

	got := pkgBoards.FlowNodeImageLinks(body)
	if len(got) != 1 || got[0] != "shot.png" {
		t.Errorf("links = %v, want the one store image named once", got)
	}
}

// A title after the target and angle brackets around it are both markdown; a space in a name
// reaches the document percent-encoded, because that is what the editor writes.
func TestFlowNodeImageLinksReadsTheTargetTheWayMarkdownWritesIt(t *testing.T) {
	body := `![a](shot.png "the screenshot")` + "\n" +
		"![b](<a picture.png>)\n" +
		"![c](/design/a%20mockup.png)\n"

	got := pkgBoards.FlowNodeImageLinks(body)
	want := []string{"shot.png", "a picture.png", "/design/a mockup.png"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("links = %v, want %v", got, want)
	}
}

// A card has no folder of its own, so its links are read from the store root — with a leading
// slash, the way the editor writes them — and never against the folder the flow node will run in.
func TestFlowNodeImagesResolveFromTheStoreRoot(t *testing.T) {
	root := t.TempDir()
	mustWriteBytes(t, filepath.Join(root, "boards/shot.png"), []byte("1234"))
	mustWriteBytes(t, filepath.Join(root, "design/mockup.png"), []byte("123456"))

	images, missing, dropped := pkgBoards.FlowNodeImages(root,
		"![shot](/boards/shot.png) ![mockup](/design/mockup.png)")

	if len(missing) != 0 || dropped != 0 {
		t.Fatalf("missing = %v, dropped = %d; want everything resolved", missing, dropped)
	}
	if len(images) != 2 {
		t.Fatalf("images = %+v, want two", images)
	}
	if images[0].Path != filepath.Join(root, "boards/shot.png") || images[0].MediaType != "image/png" || images[0].Size != 4 {
		t.Errorf("the board's picture resolved to %+v", images[0])
	}
	if images[1].Path != filepath.Join(root, "design/mockup.png") {
		t.Errorf("the picture elsewhere resolved to %+v", images[1])
	}
}

// A link is only ever a claim. What is not there, what is a folder and what points out of the store
// are all the same answer: the turn is not given it, and the user is told.
func TestFlowNodeImagesReportWhatDoesNotResolve(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "boards/pictures"), 0o755); err != nil {
		t.Fatal(err)
	}

	images, missing, _ := pkgBoards.FlowNodeImages(root,
		"![gone](/boards/gone.png) ![a folder](/boards/pictures) ![outside](../../etc/passwd.png)")

	if len(images) != 0 {
		t.Errorf("images = %+v, want none of them handed over", images)
	}
	if len(missing) != 3 {
		t.Errorf("missing = %v, want all three named", missing)
	}
}

// The cap is counted over what the store actually holds, so a body full of dead links still hands
// over every picture that is there.
func TestFlowNodeImagesCapWhatOneTurnIsGiven(t *testing.T) {
	root := t.TempDir()
	body := ""
	for i := 0; i < pkgBoards.MaxFlowNodeImages+2; i++ {
		name := string(rune('a'+i)) + ".png"
		mustWriteBytes(t, filepath.Join(root, name), []byte("1"))
		body += "![" + name + "](/" + name + ")\n"
	}

	images, _, dropped := pkgBoards.FlowNodeImages(root, body)
	if len(images) != pkgBoards.MaxFlowNodeImages || dropped != 2 {
		t.Errorf("images = %d, dropped = %d; want %d and 2", len(images), dropped, pkgBoards.MaxFlowNodeImages)
	}
}

// The prompt is the only channel the CLI has, so what the model is told about a flow node's images
// is exactly what this writes. They are listed apart from the attachments because what is true of
// the two differs: an attachment is a transient upload, a store image is a file of the store.
func TestPromptWithContextNamesTheImagesOfTheStore(t *testing.T) {
	with := pkgTurns.PromptWithContext("look at this", nil, []agentapi.PromptFile{
		{Path: "/store/boards/shot.png", MediaType: "image/png", Size: 12},
		{Path: "/store/design/mockup.jpeg", MediaType: "image/jpeg", Size: 34},
	})
	for _, want := range []string{
		"look at this", "these images, files of the store", "Read tool",
		"- /store/boards/shot.png (image/png, 12 bytes)",
		"- /store/design/mockup.jpeg (image/jpeg, 34 bytes)",
	} {
		if !strings.Contains(with, want) {
			t.Errorf("prompt is missing %q:\n%s", want, with)
		}
	}
	if strings.Contains(with, "attached") {
		t.Errorf("a flow node's images are described as attachments:\n%s", with)
	}

	one := pkgTurns.PromptWithContext("look", nil, []agentapi.PromptFile{{Path: "/store/shot.png", MediaType: "image/png"}})
	if !strings.Contains(one, "this image, a file of the store") {
		t.Errorf("one image is not described in the singular:\n%s", one)
	}
}

// The two lists are both notes of their own, and a message carrying both says both.
func TestPromptWithContextNamesAttachmentsAndImagesApart(t *testing.T) {
	both := pkgTurns.PromptWithContext("look",
		[]pkgConversations.ClaudeAttachment{{Path: "/state/att.png", MediaType: "image/png", Size: 1}},
		[]agentapi.PromptFile{{Path: "/store/shot.png", MediaType: "image/png", Size: 2}})

	if !strings.Contains(both, "/state/att.png") || !strings.Contains(both, "/store/shot.png") {
		t.Errorf("a message with both lost one of them:\n%s", both)
	}
	if strings.Index(both, "The user attached") > strings.Index(both, "The message above links") {
		t.Errorf("the notes are the wrong way round:\n%s", both)
	}
}
