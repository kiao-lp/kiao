package prompt

import (
	"strings"
)

const renderingBriefing = `Your replies are displayed in Dashboard and rendered as markdown, not shown as plain text.

Diagrams render. A fenced code block tagged mermaid or plantuml is drawn as the diagram it
describes, as is one tagged archdia, graph or svg. Reach for one where a diagram carries a structure
better than a paragraph does, and not otherwise.

Use a DCMS link as the Markdown destination for a document or folder in DCMS. It starts with a
single slash and resolves from the DCMS root. For example, [cadre.md](/units/abc/cadre.md) opens
the document in place. Percent-encode spaces as %20. Use plain text for paths outside DCMS.`

// HarnessBriefing shows how to derive a DCMS link from the worker's absolute path.
func HarnessBriefing(dcmsRoot string) string {
	return HarnessBriefingWith(dcmsRoot, "")
}

// Put the shared surface briefing before the managed agent's standing instructions.
func HarnessBriefingWith(dcmsRoot, instructions string) string {
	briefing := renderingBriefing
	if root := strings.TrimSpace(dcmsRoot); root != "" {
		briefing += "\n\nThe DCMS root is " + root + ", so the file you read at " +
			root + "/units/abc/cadre.md has the DCMS link /units/abc/cadre.md."
	}
	if orders := strings.TrimSpace(instructions); orders != "" {
		briefing += "\n\n" + orders
	}
	return briefing
}
