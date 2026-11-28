package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const AtlassianConfigFile = "atlassian.json"

type AtlassianToken struct {
	Email string `json:"email"`
	Token string `json:"token"`
}

type BitbucketConfig struct {
	AtlassianToken
	Workspace  string `json:"workspace"`
	Repository string `json:"repository"`
}

type AtlassianConfig struct {
	Bitbucket  BitbucketConfig `json:"bitbucket"`
	Confluence AtlassianToken  `json:"confluence"`
}

// ReadAtlassian loads credentials from the worker state directory at the start of an event.
func (c *Config) ReadAtlassian() (AtlassianConfig, error) {
	var credentials AtlassianConfig
	if c == nil || c.Config == nil || c.StatePath == "" {
		return credentials, errors.New("the worker has no state directory for " + AtlassianConfigFile)
	}
	path := filepath.Join(c.StatePath, AtlassianConfigFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return credentials, fmt.Errorf("cannot read Atlassian configuration: %w", err)
	}
	if err := json.Unmarshal(data, &credentials); err != nil {
		return AtlassianConfig{}, fmt.Errorf("Atlassian configuration in %s must be a JSON object with string fields", path)
	}
	return credentials, nil
}
