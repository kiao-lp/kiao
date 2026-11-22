package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResourceProxyPreservesPrefixAndUsesServerCredential(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/resources/agents/id/deletion" || r.Header.Get("Authorization") != "Bearer manager-token" || r.URL.Query().Get("check") != "1" {
			t.Errorf("resource proxy: %s %s", r.URL, r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	t.Setenv(agenticURLEnv, upstream.URL+"/resources")
	t.Setenv(agenticTokenEnv, "manager-token")
	req := httptest.NewRequest(http.MethodGet, "/api/agentic/agents/id/deletion?check=1", nil)
	req.Header.Set("Authorization", "Bearer stale-browser-token")
	result := httptest.NewRecorder()
	resourceHandler().ServeHTTP(result, req)
	if result.Code != http.StatusNoContent {
		t.Fatalf("resource proxy status: %d", result.Code)
	}
}

func TestAgenticManagerURL(t *testing.T) {
	for _, test := range []struct {
		value string
		want  string
		valid bool
	}{
		{"", "", true},
		{"  https://boards.example.com/api/agentic/  ", "https://boards.example.com/api/agentic", true},
		{"http://127.0.0.1:18082", "http://127.0.0.1:18082", true},
		{"boards.example.com/api/agentic", "", false},
		{"file:///tmp/agents", "", false},
		{"https://boards.example.com/api/agentic?token=secret", "", false},
		{"https://boards.example.com/api/agentic#agents", "", false},
		{"https://owner:secret@boards.example.com/api/agentic", "", false},
	} {
		t.Run(test.value, func(t *testing.T) {
			t.Setenv(agenticURLEnv, test.value)
			got, err := agenticManagerURL()
			if (err == nil) != test.valid || got != test.want {
				t.Fatalf("URL = %q, %v; want %q, valid %v", got, err, test.want, test.valid)
			}
		})
	}
}

func TestResourceProxyReportsMissingSharedService(t *testing.T) {
	t.Setenv(agenticURLEnv, "")
	result := httptest.NewRecorder()
	resourceHandler().ServeHTTP(result, httptest.NewRequest(http.MethodPost, "/api/agentic/agents", strings.NewReader(`{"name":"Coder"}`)))
	if result.Code != http.StatusServiceUnavailable || !strings.Contains(result.Body.String(), agenticURLEnv) {
		t.Fatalf("unconfigured service: %d %s", result.Code, result.Body.String())
	}
}

func TestResourceProxyWritesToSharedServiceWithoutBrowserCredential(t *testing.T) {
	const body = `{"path":"apm.yml","content":"name: coder"}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/agentic/agentic-resources/coder/file" || r.URL.Query().Get("path") != "apm.yml" || r.Header.Get("Authorization") != "" || r.Host == "example.com" {
			t.Errorf("resource edit: %s %s, auth %q", r.Method, r.URL, r.Header.Get("Authorization"))
		}
		received, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		if string(received) != body {
			t.Errorf("body: %s", received)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	t.Setenv(agenticURLEnv, upstream.URL+"/api/agentic/")
	t.Setenv(agenticTokenEnv, "")
	req := httptest.NewRequest(http.MethodPut, "/api/agentic/agentic-resources/coder/file?path=apm.yml", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer stale-browser-token")
	result := httptest.NewRecorder()
	resourceHandler().ServeHTTP(result, req)
	if result.Code != http.StatusNoContent {
		t.Fatalf("resource edit: %d %s", result.Code, result.Body.String())
	}
}
