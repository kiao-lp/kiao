package bitbucket

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
)

var pullRequestIDShape = regexp.MustCompile("^((" + repositorySlug + ")#)?([1-9][0-9]*)$")

func ValidPullRequestID(id string) bool { return pullRequestIDShape.MatchString(id) }

func ValidPullRequestStatus(target string) bool {
	switch target {
	case "OPEN", "MERGED", "DECLINED", "SUPERSEDED":
		return true
	default:
		return false
	}
}

func NewPullRequest(config runnerconfig.BitbucketConfig, id string) (StatusCheck, error) {
	match := pullRequestIDShape.FindStringSubmatch(id)
	if match == nil {
		return nil, errors.New("pull request ID must be a positive number or workspace/repository#number")
	}
	repo, err := newRepository(config, match[2])
	if err != nil {
		return nil, err
	}
	endpoint := repo.url + "/pullrequests/" + match[3] + "?fields=state"
	return func(ctx context.Context, client *http.Client) (string, error) {
		response, err := repo.get(ctx, client, endpoint)
		if err != nil {
			return "", err
		}
		defer response.Close()
		var body struct {
			State string `json:"state"`
		}
		if err := json.NewDecoder(io.LimitReader(response, 16<<10)).Decode(&body); err != nil || body.State == "" {
			return "", errors.New("Bitbucket returned no pull request state")
		}
		return body.State, nil
	}, nil
}
