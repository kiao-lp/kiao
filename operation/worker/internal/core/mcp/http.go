package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type httpProbe struct {
	ctx     context.Context
	url     string
	headers map[string]string
	session string
	version string
}

var probeHTTPClient = &http.Client{
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func (s *httpProbe) setVersion(version string) { s.version = version }

func (s *httpProbe) exchange(method string, id int, params any) (json.RawMessage, error) {
	resp, err := s.request(s.ctx, http.MethodPost, bytes.NewReader(requestFrame(method, id, params)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP endpoint returned HTTP %s", resp.Status)
	}
	if session := resp.Header.Get("Mcp-Session-Id"); session != "" {
		s.session = session
	}
	if id == 0 {
		return nil, nil
	}
	switch contentType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); contentType {
	case "application/json":
		frame, err := io.ReadAll(io.LimitReader(resp.Body, maxProbeReply+1))
		if err != nil {
			return nil, err
		}
		if len(frame) > maxProbeReply {
			return nil, errors.New("MCP response exceeds the diagnostic size limit")
		}
		if result, err := probeResult(frame, id); result != nil || err != nil {
			return result, err
		}
	case "text/event-stream":
		return streamProbeResult(resp.Body, id)
	default:
		return nil, fmt.Errorf("MCP endpoint replied with content type %q", contentType)
	}
	return nil, errors.New("MCP endpoint did not reply to the request")
}

func (s *httpProbe) request(ctx context.Context, method string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, s.url, body)
	if err != nil {
		return nil, err
	}
	for key, value := range s.headers {
		req.Header.Set(key, value)
	}
	req.Header.Set("Accept", "application/json, text/event-stream")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if s.session != "" {
		req.Header.Set("Mcp-Session-Id", s.session)
	}
	if s.version != "" {
		req.Header.Set("Mcp-Protocol-Version", s.version)
	}
	resp, err := probeHTTPClient.Do(req)
	var requestErr *url.Error
	if errors.As(err, &requestErr) {
		return nil, fmt.Errorf("request to %s failed: %w", req.URL.Host, requestErr.Err)
	}
	return resp, err
}

func (s *httpProbe) close() {
	if s.session == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(s.ctx), time.Second)
	defer cancel()
	if resp, err := s.request(ctx, http.MethodDelete, nil); err == nil {
		resp.Body.Close()
	}
}

func streamProbeResult(body io.Reader, id int) (json.RawMessage, error) {
	scanner := probeScanner(body)
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if value, ok := strings.CutPrefix(line, "data:"); ok {
			data.WriteString(strings.TrimPrefix(value, " "))
			data.WriteByte('\n')
			if data.Len() > maxProbeReply {
				return nil, errors.New("MCP response exceeds the diagnostic size limit")
			}
		}
		if line == "" && data.Len() != 0 {
			frame := data.String()
			data.Reset()
			if strings.TrimSpace(frame) != "" {
				if result, err := probeResult([]byte(frame), id); result != nil || err != nil {
					return result, err
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("MCP event stream closed without a reply")
}
