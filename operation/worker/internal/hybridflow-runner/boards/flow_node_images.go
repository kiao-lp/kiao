package boards

import (
	"kiao/worker/internal/core/filesystem"
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Cap model input, not disk usage, consistently with prompt attachments.
const MaxFlowNodeImages = agentapi.MaxPromptAttachments

// Loose prose matcher for links and images; group 1 captures the optional !.
var markdownLink = regexp.MustCompile(`(!?)\[[^\]\n]*\]\(([^()\n]*)\)`)

var fenceLine = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")

var schemePrefix = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)

// flowNodeImageLinks returns unique images in body order, skipping fences and URL schemes.
// Embeds are accepted regardless of extension; plain links require an image extension
// because dragging from the file tree produces plain links.
func FlowNodeImageLinks(body string) []string {
	seen := map[string]bool{}
	links := []string{}
	fence := ""
	for _, line := range strings.Split(body, "\n") {
		if marker := fenceLine.FindStringSubmatch(line); marker != nil {
			switch {
			case fence == "":
				fence = marker[1]
			case marker[1][0] == fence[0] && len(marker[1]) >= len(fence):
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		for _, found := range markdownLink.FindAllStringSubmatch(line, -1) {
			src := linkTarget(found[2])
			if src == "" || schemePrefix.MatchString(src) {
				continue
			}
			// Decode the editor's encodeURI paths (e.g. %20) into store paths.
			if decoded, err := url.PathUnescape(src); err == nil {
				src = decoded
			}
			if found[1] != "!" && !isImageName(src) {
				continue
			}
			if seen[src] {
				continue
			}
			seen[src] = true
			links = append(links, src)
		}
	}
	return links
}

// linkTarget strips optional markdown titles and enclosing angle brackets.
func linkTarget(raw string) string {
	src := strings.TrimSpace(raw)
	if strings.HasPrefix(src, "<") {
		end := strings.IndexByte(src, '>')
		if end < 0 {
			return ""
		}
		return strings.TrimSpace(src[1:end])
	}
	if space := strings.IndexAny(src, " \t"); space >= 0 {
		src = src[:space]
	}
	return src
}

func isImageName(name string) bool {
	return strings.HasPrefix(agentapi.AttachmentMediaType(name), "image/")
}

// flowNodeImages resolves store paths to regular files. Missing or invalid links
// are reported to the user without stopping play; dropped counts files over the cap.
func FlowNodeImages(root, body string) (files []agentapi.PromptFile, missing []string, dropped int) {
	for _, link := range FlowNodeImageLinks(body) {
		virtual := filesystem.NormaliseVirtual(link)
		abs, err := filesystem.ResolvePath(root, virtual)
		if err != nil {
			missing = append(missing, link)
			continue
		}
		info, err := os.Stat(abs)
		if err != nil || !info.Mode().IsRegular() {
			missing = append(missing, link)
			continue
		}
		files = append(files, agentapi.PromptFile{Path: abs, MediaType: agentapi.AttachmentMediaType(virtual), Size: info.Size()})
	}
	// Apply the cap after resolution so dead links do not consume image slots.
	if len(files) > MaxFlowNodeImages {
		dropped = len(files) - MaxFlowNodeImages
		files = files[:MaxFlowNodeImages]
	}
	return files, missing, dropped
}
