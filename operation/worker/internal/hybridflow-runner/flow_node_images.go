package hybridflowrunner

import (
	"kiao/worker/internal/core"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Flow-node images are durable store files, unlike expiring chat attachments.
// Pass their actual paths without copying. Resolve links from the store root,
// not the node's Folder setting, which only controls the turn's working directory.

// Cap model input, not disk usage, consistently with prompt attachments.
const maxFlowNodeImages = maxPromptAttachments

// Loose prose matcher for links and images; group 1 captures the optional !.
var markdownLink = regexp.MustCompile(`(!?)\[[^\]\n]*\]\(([^()\n]*)\)`)

var fenceLine = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")

var schemePrefix = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)

// flowNodeImageLinks returns unique images in body order, skipping fences and URL schemes.
// Embeds are accepted regardless of extension; plain links require an image extension
// because dragging from the file tree produces plain links.
func flowNodeImageLinks(body string) []string {
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
	return strings.HasPrefix(attachmentMediaType(name), "image/")
}

// flowNodeImages resolves store paths to regular files. Missing or invalid links
// are reported to the user without stopping play; dropped counts files over the cap.
func flowNodeImages(root, body string) (files []promptFile, missing []string, dropped int) {
	for _, link := range flowNodeImageLinks(body) {
		virtual := core.NormaliseVirtual(link)
		abs, err := core.ResolvePath(root, virtual)
		if err != nil {
			missing = append(missing, link)
			continue
		}
		info, err := os.Stat(abs)
		if err != nil || !info.Mode().IsRegular() {
			missing = append(missing, link)
			continue
		}
		files = append(files, promptFile{Path: abs, MediaType: attachmentMediaType(virtual), Size: info.Size()})
	}
	// Apply the cap after resolution so dead links do not consume image slots.
	if len(files) > maxFlowNodeImages {
		dropped = len(files) - maxFlowNodeImages
		files = files[:maxFlowNodeImages]
	}
	return files, missing, dropped
}
