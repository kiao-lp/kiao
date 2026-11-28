package filesystem

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

type releaseManifest struct {
	document    *yaml.Node
	node        *yaml.Node
	version     entities.ReleaseVersion
	description string
}

func readReleaseManifest(dir string) (*releaseManifest, error) {
	path, err := resourceFile(dir, manifestFile)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, entities.Invalidf("repository has no %s", manifestFile)
	}
	if err != nil {
		return nil, err
	}
	document, fields, err := parseAPMManifest(data)
	if err != nil {
		return nil, err
	}
	value, _ := fields["version"].(string)
	version, ok := entities.ParseReleaseVersion(value)
	if !ok {
		return nil, entities.Invalidf("%s must declare a major.minor.patch version", manifestFile)
	}
	description, _ := fields["description"].(string)
	manifest := &releaseManifest{document: document, version: version, description: strings.TrimSpace(description)}
	mapping := document.Content[0]
	for i := 0; i < len(mapping.Content); i += 2 {
		if key := mapping.Content[i]; key.ShortTag() == "!!str" && key.Value == "version" {
			manifest.node = mapping.Content[i+1]
			return manifest, nil
		}
	}
	manifest.node = &yaml.Node{}
	mapping.Content = append(mapping.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "version"}, manifest.node)
	return manifest, nil
}

type releaseTag struct {
	version entities.ReleaseVersion
	object  string
}

func (s *Store) releaseTags(ctx context.Context, dir string) ([]releaseTag, error) {
	output, err := s.git(ctx, dir, "for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/tags/v*")
	if err != nil {
		return nil, err
	}
	var tags []releaseTag
	for line := range strings.SplitSeq(string(output), "\n") {
		name, object, _ := strings.Cut(line, " ")
		if version, ok := entities.ParseReleaseVersion(strings.TrimPrefix(name, "v")); ok {
			tags = append(tags, releaseTag{version: version, object: object})
		}
	}
	slices.SortFunc(tags, func(a, b releaseTag) int { return a.version.Compare(b.version) })
	return tags, nil
}

func (m *releaseManifest) base(tags []releaseTag) entities.ReleaseVersion {
	if len(tags) > 0 && tags[len(tags)-1].version.Compare(m.version) > 0 {
		return tags[len(tags)-1].version
	}
	return m.version
}

func (s *Store) commitRelease(ctx context.Context, dir string, manifest *releaseManifest, version entities.ReleaseVersion, message string, prepare func(string) error) error {
	work, err := os.MkdirTemp("", "kiao-apm-release-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	dir, err = filepath.Abs(dir)
	if err != nil {
		return err
	}
	head, headErr := s.git(ctx, dir, "rev-parse", "--verify", "HEAD")
	base := head
	identity := []string{"-c", "user.name=KIAO", "-c", "user.email=kiao@localhost"}
	if headErr != nil {
		if _, err := s.git(ctx, dir, "symbolic-ref", "--quiet", "HEAD"); err != nil {
			return headErr
		}
		empty, err := s.git(ctx, dir, "mktree")
		if err != nil {
			return err
		}
		base, err = s.git(ctx, dir, append(slices.Clone(identity), "commit-tree", strings.TrimSpace(string(empty)), "-m", "Empty publication base")...)
		if err != nil {
			return err
		}
	}
	indexName, err := s.git(ctx, dir, "rev-parse", "--path-format=absolute", "--git-path", "index")
	if err != nil {
		return err
	}
	indexPath := strings.TrimSpace(string(indexName))
	index, err := os.ReadFile(indexPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	stage := filepath.Join(work, "source")
	if _, err = s.git(ctx, dir, "worktree", "add", "--detach", "--no-checkout", "--", stage, strings.TrimSpace(string(base))); err != nil {
		return err
	}
	defer s.git(context.WithoutCancel(ctx), dir, "worktree", "remove", "--force", "--", stage)
	stageIndex, err := s.git(ctx, stage, "rev-parse", "--path-format=absolute", "--git-path", "index")
	if err != nil {
		return err
	}
	stageIndexPath := strings.TrimSpace(string(stageIndex))

	// Use the draft's index to retain explicitly staged files. All writes go to the linked worktree's index.
	snapshot := func() (string, error) {
		if index == nil {
			if _, err := s.git(ctx, stage, "read-tree", "--empty"); err != nil {
				return "", err
			}
		} else {
			if err := os.WriteFile(stageIndexPath, index, 0600); err != nil {
				return "", err
			}
		}
		if _, err := s.git(ctx, stage, "--work-tree="+dir, "add", "--all"); err != nil {
			return "", err
		}
		tree, err := s.git(ctx, stage, "write-tree")
		return strings.TrimSpace(string(tree)), err
	}
	before, err := snapshot()
	if err != nil {
		return err
	}
	if _, err = s.git(ctx, stage, "checkout-index", "--all"); err != nil {
		return err
	}
	manifest.node.SetString(version.String())
	data, err := yaml.Marshal(manifest.document)
	if err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(stage, manifestFile), data); err != nil {
		return err
	}
	if err = s.clearReleaseSkillProjections(ctx, stage); err != nil {
		return err
	}
	if err = prepare(stage); err != nil {
		return err
	}
	if _, err = s.git(ctx, stage, "add", "--all"); err != nil {
		return err
	}
	tree, err := s.git(ctx, stage, "write-tree")
	if err != nil {
		return err
	}
	releaseTree := strings.TrimSpace(string(tree))
	diff, err := s.git(ctx, stage, "diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", before, releaseTree, "--")
	if err != nil {
		return err
	}
	patch := filepath.Join(work, "release.patch")
	if err = os.WriteFile(patch, diff, 0600); err != nil {
		return err
	}
	current, err := snapshot()
	if err != nil {
		return err
	}
	currentHead, currentHeadErr := s.git(ctx, dir, "rev-parse", "--verify", "HEAD")
	currentIndex, err := os.ReadFile(indexPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if current != before || (currentHeadErr == nil) != (headErr == nil) ||
		!bytes.Equal(currentHead, head) || !bytes.Equal(currentIndex, index) {
		return entities.Conflictf("the Git draft changed during publication preparation; retry with the current draft")
	}
	if _, err = s.git(ctx, dir, "apply", "--whitespace=nowarn", "--", patch); err != nil {
		return err
	}
	tag := "v" + version.String()
	if strings.TrimSpace(message) == "" {
		message = "feat: publish " + tag
	}
	rollback := func(err error) error {
		_, restoreErr := s.git(context.WithoutCancel(ctx), dir, "apply", "--reverse", "--whitespace=nowarn", "--", patch)
		if index == nil {
			removeErr := os.Remove(indexPath)
			if os.IsNotExist(removeErr) {
				removeErr = nil
			}
			return errors.Join(err, restoreErr, removeErr)
		}
		return errors.Join(err, restoreErr, atomicWrite(indexPath, index))
	}
	if _, err = s.git(ctx, dir, "read-tree", releaseTree); err != nil {
		return rollback(err)
	}
	if _, err = s.git(ctx, dir, append(identity, "commit", "-m", message)...); err != nil {
		return rollback(err)
	}
	_, err = s.git(ctx, dir, append(identity, "tag", "-a", tag, "-m", tag)...)
	return err
}
