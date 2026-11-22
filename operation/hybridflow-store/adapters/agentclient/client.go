package agentclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"kiao/hybridflow-store/core/entities"
)

// Client reads agent identities through the resource manager's HTTP contract.
type Client struct {
	base  *url.URL
	token string
	http  *http.Client
}

func New(base, token string) (*Client, error) {
	parsed, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, fmt.Errorf("invalid agentic-resource-manager URL")
	}
	return &Client{base: parsed, token: token, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) FindAgent(ctx context.Context, id string) (*entities.Agent, error) {
	endpoint := *c.base
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/agents/" + url.PathEscape(id)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, entities.NotFoundf("agent %s", id)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("agentic-resource-manager returned %d", response.StatusCode)
	}
	var agent entities.Agent
	if err = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&agent); err != nil {
		return nil, err
	}
	return &agent, nil
}

// Proxy preserves the agent API for clients using the boards endpoint.
func (c *Client) Proxy() http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(c.base)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
	}
	return proxy
}
