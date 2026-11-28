package bitbucket

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	runnerconfig "kiao/worker/internal/hybridflow-runner/config"
)

const apiHost = "api.bitbucket.org"
const repositorySlug = `[A-Za-z0-9_-]+/[A-Za-z0-9_-][A-Za-z0-9_.-]*`

var repositoryShape = regexp.MustCompile("^" + repositorySlug + "$")

type repository struct {
	url   string
	email string
	token string
}

func newRepository(config runnerconfig.BitbucketConfig, scope string) (repository, error) {
	if scope == "" {
		scope = strings.TrimSpace(config.Workspace) + "/" + strings.TrimSpace(config.Repository)
		if !repositoryShape.MatchString(scope) {
			return repository{}, errors.New("an unscoped ID needs valid bitbucket.workspace and bitbucket.repository in " + runnerconfig.AtlassianConfigFile)
		}
	}
	token := strings.TrimSpace(config.Token)
	if token == "" || strings.ContainsAny(token, "\r\n") {
		return repository{}, errors.New("set bitbucket.token in " + runnerconfig.AtlassianConfigFile)
	}
	return repository{
		url:   "https://" + apiHost + "/2.0/repositories/" + scope,
		email: strings.TrimSpace(config.Email),
		token: token,
	}, nil
}

func NewClient() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

type retryableError struct {
	error
	after time.Duration
}

func (r repository) get(ctx context.Context, client *http.Client, endpoint string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if r.email != "" {
		req.SetBasicAuth(r.email, r.token)
	} else {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, &retryableError{error: errors.New("could not reach Bitbucket")}
	}
	if res.StatusCode == http.StatusOK {
		return res.Body, nil
	}
	res.Body.Close()
	err = fmt.Errorf("Bitbucket returned HTTP %d", res.StatusCode)
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= http.StatusInternalServerError {
		return nil, &retryableError{error: err, after: retryAfter(res.Header.Get("Retry-After"))}
	}
	return nil, err
}

func retryAfter(header string) time.Duration {
	if seconds, err := strconv.ParseUint(header, 10, 32); err == nil {
		return time.Duration(seconds) * time.Second
	}
	if until, err := http.ParseTime(header); err == nil {
		return time.Until(until)
	}
	return 0
}

type StatusCheck func(context.Context, *http.Client) (string, error)

// Wait checks immediately and retries transport failures, throttling and server errors.
func (check StatusCheck) Wait(ctx context.Context, client *http.Client, target string, interval time.Duration, onRetry func(error)) error {
	var lastError string
	for ctx.Err() == nil {
		state, err := check(ctx, client)
		if ctx.Err() != nil {
			break
		}
		if err == nil && state == target {
			return nil
		}
		delay := interval
		var retry *retryableError
		switch {
		case err == nil:
			lastError = ""
		case errors.As(err, &retry):
			delay = max(delay, retry.after)
			if err.Error() != lastError {
				onRetry(err)
				lastError = err.Error()
			}
		default:
			return err
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
		case <-timer.C:
		}
		timer.Stop()
	}
	return ctx.Err()
}
