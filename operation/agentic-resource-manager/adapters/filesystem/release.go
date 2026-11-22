package filesystem

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
	"kiao/agentic-resource-manager/core/entities"
)

type releaseManifest struct {
	path     string
	original []byte
	document *yaml.Node
	node     *yaml.Node
	version  entities.ReleaseVersion
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
	manifest := &releaseManifest{path: path, original: data, document: document, version: version}
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

func (s *Store) releaseTags(ctx context.Context, dir string) ([]entities.ReleaseVersion, error) {
	output, err := s.git(ctx, dir, "tag", "--list", "v*")
	if err != nil {
		return nil, err
	}
	var versions []entities.ReleaseVersion
	for _, tag := range strings.Fields(string(output)) {
		if version, ok := entities.ParseReleaseVersion(strings.TrimPrefix(tag, "v")); ok {
			versions = append(versions, version)
		}
	}
	slices.SortFunc(versions, entities.ReleaseVersion.Compare)
	return versions, nil
}

func (m *releaseManifest) base(tags []entities.ReleaseVersion) entities.ReleaseVersion {
	if len(tags) > 0 && tags[len(tags)-1].Compare(m.version) > 0 {
		return tags[len(tags)-1]
	}
	return m.version
}

func (s *Store) commitRelease(ctx context.Context, dir string, manifest *releaseManifest, version entities.ReleaseVersion, message string, prepare func() error) (err error) {
	manifest.node.SetString(version.String())
	data, err := yaml.Marshal(manifest.document)
	if err != nil {
		return err
	}
	if err = atomicWrite(manifest.path, data); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			err = errors.Join(err, atomicWrite(manifest.path, manifest.original))
		}
	}()
	if err = prepare(); err != nil {
		return err
	}
	if _, err = s.git(ctx, dir, "add", "--all"); err != nil {
		return err
	}
	tag := "v" + version.String()
	if strings.TrimSpace(message) == "" {
		message = "feat: publish " + tag
	}
	identity := []string{"-c", "user.name=KIAO", "-c", "user.email=kiao@localhost"}
	if _, err = s.git(ctx, dir, append(identity, "commit", "-m", message)...); err != nil {
		return err
	}
	committed = true
	_, err = s.git(ctx, dir, append(identity, "tag", "-a", tag, "-m", tag)...)
	return err
}
