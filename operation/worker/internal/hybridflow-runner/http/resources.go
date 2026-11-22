package runnerhttp

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func (s *Service) HandleResourceManager(w http.ResponseWriter, r *http.Request) {
	target, err := url.Parse(s.cfg.AgenticURL)
	if err != nil || target.Host == "" {
		http.Error(w, "agentic-resource-manager is not configured", http.StatusServiceUnavailable)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		request.URL.Path = strings.TrimPrefix(request.URL.Path, "/agentic-resources-api")
		request.URL.RawPath = ""
		director(request)
		if s.cfg.AgenticToken != "" {
			request.Header.Set("Authorization", "Bearer "+s.cfg.AgenticToken)
		}
	}
	proxy.ServeHTTP(w, r)
}
