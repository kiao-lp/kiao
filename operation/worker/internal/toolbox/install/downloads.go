package install

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// downloadTimeout bounds one HTTP download, which is a Go-side io.Copy rather than a process.
const downloadTimeout = 20 * time.Minute

// releaseVersion is the shape a version has to have before it is put in a URL. It is a guard against
// a release service that answered something other than a version — an error page, a redirect to a
// sign-in — rather than a validation of the number itself.
var releaseVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+`)

// download fetches url to dest, verifying sha256 when one is given. The digest is computed while
// the body streams, so a 200 MB JDK is never held in memory and a mismatch throws the file away
// rather than leaving a half-trusted archive on disk.
func (in *installer) download(url, dest, sha string) error {
	in.log.printf("downloading %s", url)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", filepath.Dir(dest), err)
	}

	resp, err := in.client.Get(url)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading %s: the server answered %s", url, resp.Status)
	}

	file, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("cannot write %s: %w", dest, err)
	}
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, digest), resp.Body)
	closeErr := file.Close()
	if err != nil {
		os.Remove(dest)
		return fmt.Errorf("downloading %s: %w", url, err)
	}
	if closeErr != nil {
		os.Remove(dest)
		return fmt.Errorf("cannot write %s: %w", dest, closeErr)
	}

	if sha != "" {
		got := hex.EncodeToString(digest.Sum(nil))
		if !strings.EqualFold(got, sha) {
			os.Remove(dest)
			return fmt.Errorf("%s does not match its published checksum (expected %s, got %s)", url, sha, got)
		}
		in.log.printf("checksum verified (%d bytes)", written)
	} else {
		in.log.printf("downloaded %d bytes", written)
	}
	return nil
}

// getJSON reads one small JSON document — a release index, an asset list.
func (in *installer) getJSON(url string, into any) error {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	// Bounded: these are catalogues of releases, and an unbounded decode of whatever a redirect
	// landed on is not something to do inside a service.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("reading %s: %w", url, err)
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("parsing %s: %w", url, err)
	}
	return nil
}

// text reads one short plain-text answer — a release service's idea of "latest", which is a version
// and nothing else. Bounded like getJSON, and trimmed, because what is on the other end is one line.
func (in *installer) text(url string) (string, error) {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	return strings.TrimSpace(string(body)), nil
}

// checksumFromSHASUMS reads the digest of one file out of a `sha256  name` listing.
func (in *installer) checksumFromSHASUMS(url, name string) (string, error) {
	in.log.printf("asking %s", url)
	resp, err := in.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("reading %s: the server answered %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", url, err)
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == name {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("%s lists no checksum for %s", url, name)
}

// unpackInto extracts a tarball whose single top-level directory becomes dest. Extraction is `tar`
// rather than a decoder written here: every one of the three systems has it, it handles the symlinks
// and the modes a JDK is full of, and a tar implementation is not a thing to maintain in a file
// service.
func (in *installer) unpackInto(archive, dest string) error {
	staging := dest + ".unpacking"
	if err := os.RemoveAll(staging); err != nil {
		return fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)

	if err := in.run([]string{"tar", "-xzf", archive, "-C", staging}, in.cfg.Prefix); err != nil {
		return err
	}

	entries, err := os.ReadDir(staging)
	if err != nil {
		return fmt.Errorf("reading %s: %w", staging, err)
	}
	var top string
	for _, entry := range entries {
		if entry.IsDir() {
			if top != "" {
				return fmt.Errorf("%s unpacks to more than one directory", filepath.Base(archive))
			}
			top = filepath.Join(staging, entry.Name())
		}
	}
	if top == "" {
		return fmt.Errorf("%s unpacks to no directory", filepath.Base(archive))
	}

	// Replace rather than merge: an upgrade over a previous install would otherwise leave the old
	// release's files behind, and a JDK half of one version and half of another is worse than none.
	if err := os.RemoveAll(dest); err != nil {
		return fmt.Errorf("cannot clear %s: %w", dest, err)
	}
	if err := os.Rename(top, dest); err != nil {
		return fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("unpacked into %s", dest)
	return nil
}

// unpackTreeInto extracts a tarball that *is* the tree: several top-level entries, none of them a
// wrapper directory to step through. The Codex package is one — `bin/`, `codex-path/` and
// `codex-resources/` side by side, and the binary resolves the last two relative to itself — so
// hoisting a single directory the way unpackInto does would be wrong rather than merely unnecessary.
func (in *installer) unpackTreeInto(archive, dest string) error {
	staging := dest + ".unpacking"
	if err := os.RemoveAll(staging); err != nil {
		return fmt.Errorf("cannot clear %s: %w", staging, err)
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return fmt.Errorf("cannot create %s: %w", staging, err)
	}
	defer os.RemoveAll(staging)

	if err := in.run([]string{"tar", "-xzf", archive, "-C", staging}, in.cfg.Prefix); err != nil {
		return err
	}

	// Replace rather than merge, for unpackInto's reason: a release half of one version and half of
	// another is worse than none.
	if err := os.RemoveAll(dest); err != nil {
		return fmt.Errorf("cannot clear %s: %w", dest, err)
	}
	if err := os.Rename(staging, dest); err != nil {
		return fmt.Errorf("cannot move %s into place: %w", dest, err)
	}
	in.log.printf("unpacked into %s", dest)
	return nil
}
