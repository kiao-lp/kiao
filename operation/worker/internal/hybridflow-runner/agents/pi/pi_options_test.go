package pi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestPiConnectionDiagnosticDistinguishesRuntimeAndAPIFailures(t *testing.T) {
	for _, scenario := range []struct{ mode, status, detail string }{
		{"crash", "runtime_error", "simulated Pi crash"},
		{"api-error-exit", "api_error", "401 Invalid API key"},
		{"empty-success", "runtime_error", "without a model reply"},
		{"invalid-json", "runtime_error", "Pi emitted invalid JSONL"},
		{"large-stderr", "runtime_error", "stack frame"},
		{"reject-model", "configuration_error", "model configuration is invalid"},
	} {
		t.Run(scenario.mode, func(t *testing.T) {
			_, profiles, _, _ := piTestSetup(t, "")
			t.Setenv("KIAO_TEST_PI_DIAGNOSTIC", scenario.mode)
			t.Setenv("KIAO_TEST_DIAGNOSTIC_KEY", "diagnostic-fixture-private-key")
			doc, _ := profiles.ReadProfiles()
			doc.Profiles[0].Connections[0].SecretRef = "env:KIAO_TEST_DIAGNOSTIC_KEY"
			if err := profiles.WriteProfiles(doc); err != nil {
				t.Fatal(err)
			}
			err := profiles.CheckConnection("work", "")
			var diagnostic *PiConnectionDiagnostic
			if !errors.As(err, &diagnostic) || diagnostic.Status != scenario.status || !strings.Contains(diagnostic.Error(), scenario.detail) {
				t.Fatalf("diagnostic = %v, wanted %s with %q", err, scenario.status, scenario.detail)
			}
			if strings.Contains(diagnostic.Error(), "diagnostic-fixture-private-key") {
				t.Fatal("private API key leaked in the diagnostic")
			}
			if scenario.mode == "crash" && !strings.Contains(diagnostic.Details, "Pi exit status: 7") {
				t.Fatal("exit status was lost")
			}
			if len(diagnostic.Details) > (8<<10)+200 {
				t.Fatal("Pi error output was not bounded")
			}
		})
	}
}

func TestPiReferenceConnectionDiagnostic(t *testing.T) {
	binary := os.Getenv("KIAO_PI_TEST_CLI")
	if binary == "" {
		t.Skip("set KIAO_PI_TEST_CLI to a qualified Pi executable")
	}
	for _, scenario := range []struct {
		name    string
		status  int
		message string
	}{
		{name: "success", status: http.StatusOK},
		{name: "zstd_response", status: http.StatusOK},
		{name: "invalid_key", status: http.StatusUnauthorized, message: "The supplied API key was rejected"},
		{name: "invalid_model", status: http.StatusNotFound, message: "The requested model does not exist"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer diagnostic-fixture-key" {
					t.Error("the diagnostic did not use its profile key")
				}
				var request map[string]any
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					t.Error("invalid API request")
				}
				limit, _ := request["max_tokens"].(float64)
				if value, ok := request["max_completion_tokens"].(float64); ok {
					limit = value
				}
				if limit <= 0 || limit > 256 {
					t.Errorf("diagnostic output budget = %v", limit)
				}
				if scenario.status != http.StatusOK {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(scenario.status)
					fmt.Fprintf(w, `{"error":{"message":%q,"type":"invalid_request_error"}}`, scenario.message)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if scenario.name == "zstd_response" {
					body, err := base64.StdEncoding.DecodeString("KLUv/WBYAJUFANKLJB9gh9MGYdq2sckG/Wz1txGB/XB1hA+n+eMmYAoASc8Kx5EIEBwCEKtgUNfbRwWCwc6Ki+1EM4xtGDQ4do6SdWabfxwrWUo5atflwyaxcGoqjtYHDoqt23rNyXy3o9rmj/1aoXJEsDdQ0fyDsDOm3CUdfaHOkhDdbFQMYxPSt6TbO+FBwR4dG6cbqbhdyT8Adn1KCgA7UwbNwjol/I9AiCVnQdHhLadik69g76yWigI=")
					if err != nil {
						t.Error(err)
						return
					}
					w.Header().Set("Content-Encoding", "zstd")
					_, _ = w.Write(body)
					return
				}
				fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"OK\"},\"finish_reason\":null}]}\n\n")
				fmt.Fprint(w, "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":1,\"total_tokens\":21}}\n\ndata: [DONE]\n\n")
			}))
			defer server.Close()
			_, profiles, _, _ := piTestSetup(t, binary)
			doc, _ := profiles.ReadProfiles()
			connection := &doc.Profiles[0].Connections[0]
			connection.Provider = "CustomProvider"
			connection.BaseURL = server.URL + "/v1"
			connection.SecretRef = "env:KIAO_TEST_DIAGNOSTIC_KEY"
			connection.Models[0].ContextWindow = 1048576
			connection.Models[0].MaxTokens = 384000
			doc.Profiles[0].DefaultModel = "CustomProvider/shared-model"
			t.Setenv("KIAO_TEST_DIAGNOSTIC_KEY", "diagnostic-fixture-key")
			if err := profiles.WriteProfiles(doc); err != nil {
				t.Fatal(err)
			}
			err := profiles.CheckConnection("work", "")
			if scenario.message == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), scenario.message) {
				t.Fatalf("diagnostic = %v, expected provider error %q", err, scenario.message)
			}
			stored, _ := profiles.ReadProfiles()
			if stored.Profiles[0].Connections[0].Models[0].MaxTokens != 384000 {
				t.Fatal("diagnostic changed the stored model limits")
			}
			if scenario.message != "" {
				var diagnostic *PiConnectionDiagnostic
				if !errors.As(err, &diagnostic) || diagnostic.Status != "api_error" {
					t.Fatalf("provider failure misclassified: %v", err)
				}
			}
		})
	}
}
