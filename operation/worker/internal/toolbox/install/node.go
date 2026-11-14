package install

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/filesystem"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"os"
	"os/exec"
	"path/filepath"
)

// nodeDistIndex is the manifest nodejs.org publishes of every release it has, newest first, each
// saying whether it is an LTS line. "the latest LTS" is a question with a moving answer, so it is
// asked at install time rather than pinned in the catalogue.
const nodeDistIndex = "https://nodejs.org/dist/index.json"

// installNode fetches the official Node build, verified against the SHASUMS256.txt published
// beside it, and unpacks it as <prefix>/node.
func (in *installer) installNode(recipe toolcatalog.Recipe) (string, error) {
	arch, ok := toolconfig.HostArch()
	if !ok {
		return "", fmt.Errorf("no Node build is published for this machine's architecture")
	}

	version := recipe.Version
	if version == "" || version == "lts" {
		resolved, err := in.latestNodeLTS()
		if err != nil {
			return "", err
		}
		version = resolved
		in.log.printf("the current Node LTS is %s", version)
	}

	name := fmt.Sprintf("node-%s-linux-%s.tar.gz", version, arch)
	base := "https://nodejs.org/dist/" + version + "/"

	sum, err := in.checksumFromSHASUMS(base+"SHASUMS256.txt", name)
	if err != nil {
		return "", err
	}
	archive := filepath.Join(in.cfg.DownloadDir(), name)
	if err := in.download(base+name, archive, sum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackInto(archive, in.cfg.NodeDir()); err != nil {
		return "", err
	}
	return in.versionOf(filepath.Join(in.cfg.NodeDir(), "bin", "node"), "--version")
}

// latestNodeLTS answers the newest release on an LTS line. The index is newest first, so the first
// entry whose `lts` field is not false is the one.
func (in *installer) latestNodeLTS() (string, error) {
	var releases []struct {
		Version string          `json:"version"`
		LTS     json.RawMessage `json:"lts"`
	}
	if err := in.getJSON(nodeDistIndex, &releases); err != nil {
		return "", err
	}
	for _, r := range releases {
		// `lts` is either the codename string or the literal false, which is why it is read raw.
		if len(r.LTS) > 0 && string(r.LTS) != "false" {
			return r.Version, nil
		}
	}
	return "", fmt.Errorf("nodejs.org lists no LTS release")
}

// nodeBin is the node this service runs a server with: the prefix's if it installed one, the
// deployment's configured one otherwise (the same value the migrations and the kiao-mcp bundle
// use). Resolved to an absolute path at install time and written into the ledger, so a turn is
// never handed a command whose meaning depends on a PATH this service does not control.
func (in *installer) nodeBin() string {
	if bin := filepath.Join(in.cfg.NodeDir(), "bin", "node"); filesystem.FileExists(bin) {
		return bin
	}
	if path, err := exec.LookPath(in.cfg.NodeBinary); err == nil {
		return path
	}
	return in.cfg.NodeBinary
}
