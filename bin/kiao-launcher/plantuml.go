package main

import (
	"bytes"
	"compress/flate"
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// PlantUML, without a PlantUML server.
//
// Diagrams are a core feature of KIAO, so the renderer travels with the executable: the install script
// lays a pinned plantuml.jar down in <home>/lib, and that is the one used unless the machine is
// told otherwise. Nothing has to be found, installed or signed up for — a JRE aside, which is the
// one part of this that belongs to the machine rather than to us.
//
// The image runs plantuml.jar's own picoweb server and proxies to it; here the jar is run per
// diagram, `-tsvg -pipe`, which is a mode every version of it has had — so a jar the machine
// already had answers to it just as ours does — and which means no third port and nothing to keep
// alive. A JVM start is ~1s, so what is rendered is cached, and the browser is told it may cache it
// too — the URL is a digest of the source, so it changes whenever the diagram does.
//
// Nothing is sent anywhere: the diagrams in a store are its content, and the public
// plantuml.com server is not where they belong by default. --plantuml-server is there for whoever
// decides otherwise.
type plantUML struct {
	jar        string // run as: java -jar <jar> -t<fmt> -pipe
	command    string // run as: <command> -t<fmt> -pipe
	java       string
	bundledJar string // <home>/lib/plantuml.jar, when it is there — the one shipped with the executable
	proxy      *httputil.ReverseProxy
	target     string

	sem   chan struct{} // a page of diagrams must not fork a JVM per diagram
	mu    sync.Mutex
	cache map[string][]byte
}

// Where Debian's plantuml package and the common manual installs put the jar. Only a fallback now
// that one is installed with the executable, and kept for the machine that has its own.
var jarLocations = []string{
	"/usr/share/plantuml/plantuml.jar",
	"/usr/share/java/plantuml.jar",
	"/opt/plantuml/plantuml.jar",
}

func newPlantUML(installDir, explicit, server string) *plantUML {
	p := &plantUML{sem: make(chan struct{}, 3), cache: map[string][]byte{}}

	if server != "" {
		if target, err := url.Parse(strings.TrimSuffix(server, "/")); err == nil {
			p.target = target.String()
			p.proxy = &httputil.ReverseProxy{
				Director: func(r *http.Request) {
					r.URL.Scheme, r.URL.Host = target.Scheme, target.Host
					r.URL.Path = target.Path + strings.TrimPrefix(r.URL.Path, "/plantuml")
					r.URL.RawPath = ""
					r.Host = target.Host
				},
			}
			return p
		}
	}

	p.java = findJava()
	switch {
	case explicit != "" && strings.HasSuffix(explicit, ".jar"):
		p.jar = explicit
	case explicit != "":
		p.command = explicit
	default:
		p.detect(installDir)
	}
	return p
}

// detect picks a renderer: the jar the machine was told to use, then the one installed beside the
// executable, then one the machine packaged itself, then a plantuml command. A jar is only worth
// choosing if there is a JVM to run it with — without one, the wrapper script of a manual install
// is the last thing that can still draw anything.
func (p *plantUML) detect(installDir string) {
	if installDir != "" {
		bundled := filepath.Join(installDir, "lib", "plantuml.jar")
		if _, err := os.Stat(bundled); err == nil {
			p.bundledJar = bundled
		}
	}
	if jar := os.Getenv("PLANTUML_JAR"); jar != "" && p.java != "" {
		if _, err := os.Stat(jar); err == nil {
			p.jar = jar
			return
		}
	}
	if p.java != "" {
		if p.bundledJar != "" {
			p.jar = p.bundledJar
			return
		}
		for _, jar := range jarLocations {
			if _, err := os.Stat(jar); err == nil {
				p.jar = jar
				return
			}
		}
	}
	// The Debian package installs a wrapper script as well as the jar; a manual install often has
	// only the script. Either way it takes the same flags.
	if path, err := exec.LookPath("plantuml"); err == nil {
		p.command = path
	}
}

func findJava() string {
	if home := os.Getenv("JAVA_HOME"); home != "" {
		candidate := filepath.Join(home, "bin", "java")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	path, err := exec.LookPath("java")
	if err != nil {
		return ""
	}
	return path
}

func (p *plantUML) available() bool { return p.proxy != nil || p.jar != "" || p.command != "" }

func (p *plantUML) describe() string {
	switch {
	case p.proxy != nil:
		return p.target + " (proxied)"
	case p.jar != "" && p.jar == p.bundledJar:
		return p.jar + " (shipped with the executable)"
	case p.jar != "":
		return p.jar
	case p.command != "":
		return p.command
	default:
		title, hints := p.unavailable()
		return strings.TrimSuffix(title, ".") + " — " + hints[0]
	}
}

// unavailable says what is missing and what to do about it — as the startup line, and as the notice
// drawn where the diagram would have been. A jar is installed with the executable, so on almost every
// machine that gets here what is missing is the JVM, not the renderer.
func (p *plantUML) unavailable() (string, []string) {
	if p.bundledJar != "" {
		return "No Java to run PlantUML with.", []string{
			"sudo apt install default-jre-headless",
			"(the renderer itself is here: " + p.bundledJar + ")",
		}
	}
	return "No PlantUML renderer on this machine.", []string{
		"install it with: bin/install-kiao-executable.sh",
		"or: kiao --plantuml-server <url>",
	}
}

// The formats the SPA asks for, and what plantuml calls them.
var plantUMLFormats = map[string]struct{ flag, contentType string }{
	"svg":  {"-tsvg", "image/svg+xml"},
	"png":  {"-tpng", "image/png"},
	"txt":  {"-tutxt", "text/plain; charset=utf-8"},
	"utxt": {"-tutxt", "text/plain; charset=utf-8"},
}

func (p *plantUML) handle(w http.ResponseWriter, r *http.Request) {
	if p.proxy != nil {
		p.proxy.ServeHTTP(w, r)
		return
	}

	// /plantuml/<format>/<encoded>
	rest := strings.TrimPrefix(r.URL.Path, "/plantuml/")
	format, encoded, ok := strings.Cut(rest, "/")
	spec, known := plantUMLFormats[format]
	if !ok || !known || encoded == "" {
		http.Error(w, "expected /plantuml/svg/<encoded diagram>", http.StatusNotFound)
		return
	}

	if !p.available() {
		// An <img> whose source 404s is a broken-image icon and nothing else; an SVG that says
		// what is missing is read where the diagram would have been.
		title, hints := p.unavailable()
		writeSVG(w, noticeSVG(append([]string{title}, hints...)...))
		return
	}

	source, err := decodePlantUML(encoded)
	if err != nil {
		writeSVG(w, noticeSVG("Unreadable diagram URL.", err.Error()))
		return
	}

	key := format + ":" + encoded
	if cached := p.cached(key); cached != nil {
		writeRendered(w, spec.contentType, cached)
		return
	}

	rendered, err := p.render(r.Context(), spec.flag, source)
	if err != nil {
		writeSVG(w, noticeSVG("PlantUML failed.", err.Error()))
		return
	}
	p.store(key, rendered)
	writeRendered(w, spec.contentType, rendered)
}

func (p *plantUML) render(ctx context.Context, flag, source string) ([]byte, error) {
	select {
	case p.sem <- struct{}{}:
		defer func() { <-p.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if p.jar != "" {
		if p.java == "" {
			return nil, fmt.Errorf("no java to run %s with", p.jar)
		}
		cmd = exec.CommandContext(ctx, p.java, "-Djava.awt.headless=true", "-jar", p.jar,
			flag, "-pipe", "-charset", "UTF-8")
	} else {
		cmd = exec.CommandContext(ctx, p.command, flag, "-pipe", "-charset", "UTF-8")
	}
	var out, errOut bytes.Buffer
	cmd.Stdin = strings.NewReader(source)
	cmd.Stdout, cmd.Stderr = &out, &errOut

	// A syntax error is not a failure of the renderer: plantuml draws the complaint and exits
	// non-zero, and that drawing is exactly what should appear in the page. Only an empty output
	// is a real failure.
	if err := cmd.Run(); err != nil && out.Len() == 0 {
		detail := strings.TrimSpace(errOut.String())
		if detail == "" {
			detail = err.Error()
		}
		return nil, fmt.Errorf("%s", detail)
	}
	return out.Bytes(), nil
}

func (p *plantUML) cached(key string) []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cache[key]
}

func (p *plantUML) store(key string, data []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	// A flat cap, emptied when it is reached. An LRU would keep more of the right entries; for a
	// few hundred diagrams re-rendered in a second each, it would not be worth its own bug.
	if len(p.cache) >= 256 {
		p.cache = map[string][]byte{}
	}
	p.cache[key] = data
}

func writeRendered(w http.ResponseWriter, contentType string, data []byte) {
	w.Header().Set("Content-Type", contentType)
	// The URL encodes the diagram, so a changed diagram is a changed URL and this can never be
	// stale — unlike the bundle, which is served no-store.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(data)
}

func writeSVG(w http.ResponseWriter, svg string) {
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "no-store")
	io.WriteString(w, svg)
}

// noticeSVG draws a few lines of text where a diagram would have been. Grey on nothing, so it
// reads on both Dashboard themes.
func noticeSVG(lines ...string) string {
	var b strings.Builder
	height := 24*len(lines) + 24
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="%d" role="img">`, height)
	b.WriteString(`<rect width="100%" height="100%" fill="none" stroke="#8888" stroke-dasharray="4 4"/>`)
	for i, line := range lines {
		weight := "normal"
		if i == 0 {
			weight = "bold"
		}
		fmt.Fprintf(&b, `<text x="16" y="%d" font-family="monospace" font-size="14" font-weight="%s" fill="#888">%s</text>`,
			32+24*i, weight, html.EscapeString(line))
	}
	b.WriteString(`</svg>`)
	return b.String()
}

// decodePlantUML undoes what plantuml-encoder does in the SPA: deflate, then a base64 with
// PlantUML's own alphabet. Both halves are the format's, not a library's — the encoding is part of
// the URL scheme every PlantUML server speaks.
func decodePlantUML(encoded string) (string, error) {
	// Some encoders mark the compression with a prefix; plantuml-encoder does not, but a URL
	// written by hand may.
	encoded = strings.TrimPrefix(encoded, "~1")
	compressed := decodePlantUML64(encoded)
	source, err := io.ReadAll(flate.NewReader(bytes.NewReader(compressed)))
	if len(source) == 0 {
		if err != nil {
			return "", fmt.Errorf("not a PlantUML-encoded diagram: %w", err)
		}
		return "", fmt.Errorf("not a PlantUML-encoded diagram")
	}
	// A trailing error is expected rather than exceptional: the last 4-character group decodes to
	// 3 bytes whether or not the deflate stream needed them, so there is regularly a byte or two
	// past the end of it.
	return string(source), nil
}

// The alphabet is 0-9, A-Z, a-z, then '-' and '_' — base64's digits in a different order.
func decodePlantUML64(s string) []byte {
	sixBits := func(c byte) byte {
		switch {
		case c >= '0' && c <= '9':
			return c - '0'
		case c >= 'A' && c <= 'Z':
			return c - 'A' + 10
		case c >= 'a' && c <= 'z':
			return c - 'a' + 36
		case c == '-':
			return 62
		case c == '_':
			return 63
		}
		return 0
	}
	at := func(i int) byte {
		if i < len(s) {
			return sixBits(s[i])
		}
		return 0
	}
	out := make([]byte, 0, len(s)*3/4+3)
	for i := 0; i < len(s); i += 4 {
		c1, c2, c3, c4 := at(i), at(i+1), at(i+2), at(i+3)
		out = append(out,
			c1<<2|c2>>4,
			c2<<4|c3>>2,
			c3<<6|c4)
	}
	return out
}
