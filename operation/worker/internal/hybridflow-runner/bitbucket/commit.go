package bitbucket

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
)

var commitIDShape = regexp.MustCompile("^((" + repositorySlug + ")@)?([a-fA-F0-9]{7,40})$")

var commitStatusPriority = map[string]int{
	"SUCCESSFUL": 1,
	"STOPPED":    2,
	"INPROGRESS": 3,
	"FAILED":     4,
}

func ValidCommitID(id string) bool { return commitIDShape.MatchString(id) }

func ValidCommitStatus(target string) bool { return commitStatusPriority[target] > 0 }

func NewCommit(config runnerconfig.BitbucketConfig, id string) (StatusCheck, error) {
	match := commitIDShape.FindStringSubmatch(id)
	if match == nil {
		return nil, errors.New("commit ID must be a Git hash or workspace/repository@hash")
	}
	repo, err := newRepository(config, match[2])
	if err != nil {
		return nil, err
	}
	endpoint := repo.url + "/commit/" + strings.ToLower(match[3]) + "/statuses?fields=next,values.state"
	return func(ctx context.Context, client *http.Client) (string, error) {
		return repo.commitStatus(ctx, client, endpoint)
	}, nil
}

type commitStatusPage struct {
	Next   string `json:"next"`
	Values []struct {
		State string `json:"state"`
	} `json:"values"`
}

func (r repository) commitStatus(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	var state string
	var unknown bool
	seen := make(map[string]bool)
	for endpoint != "" {
		pageURL, err := url.Parse(endpoint)
		if err != nil || pageURL.Scheme != "https" || pageURL.Host != apiHost || pageURL.User != nil || seen[endpoint] {
			return "", errors.New("Bitbucket returned an invalid commit status page link")
		}
		seen[endpoint] = true
		page, err := r.commitStatuses(ctx, client, endpoint)
		if err != nil {
			return "", err
		}
		for _, status := range page.Values {
			if status.State == "FAILED" {
				return "FAILED", nil
			}
			priority := commitStatusPriority[status.State]
			unknown = unknown || priority == 0
			if priority > commitStatusPriority[state] {
				state = status.State
			}
		}
		endpoint = page.Next
	}
	if unknown && state == "SUCCESSFUL" {
		return "", nil
	}
	return state, nil
}

func (r repository) commitStatuses(ctx context.Context, client *http.Client, endpoint string) (commitStatusPage, error) {
	var page commitStatusPage
	response, err := r.get(ctx, client, endpoint)
	if err != nil {
		return page, err
	}
	defer response.Close()
	if err := json.NewDecoder(io.LimitReader(response, 1<<20)).Decode(&page); err != nil || page.Values == nil {
		return page, errors.New("Bitbucket returned no commit status list")
	}
	return page, nil
}
