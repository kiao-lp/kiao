package main

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

const agenticURLEnv = "KIAO_AGENTIC_RESOURCE_MANAGER_URL"
const agenticTokenEnv = "KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN"

func agenticManagerURL() (string, error) {
	remote := strings.TrimRight(strings.TrimSpace(os.Getenv(agenticURLEnv)), "/")
	if remote == "" {
		return "", nil
	}
	parsed, err := url.Parse(remote)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", fmt.Errorf("%s must be a service URL like https://boards.example.com/api/agentic", agenticURLEnv)
	}
	return remote, nil
}

func resourceHandler() http.Handler {
	remote, err := agenticManagerURL()
	if err != nil || remote == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "set "+agenticURLEnv+" to the shared agentic-resource-manager", http.StatusServiceUnavailable)
		})
	}
	base, _ := url.Parse(remote)
	token := strings.TrimSpace(os.Getenv(agenticTokenEnv))
	proxy := httputil.NewSingleHostReverseProxy(base)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/agentic")
		r.URL.RawPath = ""
		director(r)
		r.Host = base.Host
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		} else {
			r.Header.Del("Authorization")
		}
	}
	proxy.Transport = remoteTransport
	return proxy
}
