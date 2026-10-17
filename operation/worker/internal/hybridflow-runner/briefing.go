package hybridflowrunner

import "strings"

// Surface instructions are shared by all agents; each driver supplies its transport.
// Send them as system/developer instructions, not prompt text, to avoid repeating
// them in the user-visible transcript.

const renderingBriefing = `Your replies are displayed in Dashboard and rendered as markdown, not shown as plain text.

Diagrams render. A fenced code block tagged mermaid or plantuml is drawn as the diagram it
describes, as is one tagged archdia, graph or svg. Reach for one where a diagram carries a structure
better than a paragraph does, and not otherwise.

Links to the store open in place. Refer to a file of the store as a markdown link whose destination
is that file's path from the store root, with a leading slash — [cadre.md](/units/abc/cadre.md) —
and the reader opens it in the CMS in one click. Percent-encode a space in the path, or the
destination ends at it. A file outside the store has no such link: name it as plain text.`

// agentBriefing anchors store links to this deployment; omit the anchor if unresolved.
func agentBriefing(storeRoot string) string {
	return agentBriefingWith(storeRoot, "")
}

// Put the shared surface briefing before the managed agent's standing instructions.
func agentBriefingWith(storeRoot, instructions string) string {
	briefing := renderingBriefing
	if root := strings.TrimSpace(storeRoot); root != "" {
		briefing += "\n\nThe store root is " + root + ", so the file you read at " +
			root + "/units/abc/cadre.md is linked as /units/abc/cadre.md."
	}
	if orders := strings.TrimSpace(instructions); orders != "" {
		briefing += "\n\n" + orders
	}
	return briefing
}
