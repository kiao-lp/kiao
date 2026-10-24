package config

import (
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func DetectPlatform() string {
	if runtime.GOOS != "linux" {
		return toolcatalog.PlatformGeneric
	}
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return toolcatalog.PlatformGeneric
	}
	return DetectPlatformFrom(OsReleaseIDs(string(data)))
}

func DetectPlatformFrom(ids []string) string {
	for _, id := range ids {
		switch id {
		case "alpine":
			return toolcatalog.PlatformAlpine
		case "debian", "ubuntu", "linuxmint", "raspbian", "pop":
			return toolcatalog.PlatformDebian
		}
	}
	return toolcatalog.PlatformGeneric
}

// osReleaseIDs returns ID before ID_LIKE so a derivative takes precedence over its family.
func OsReleaseIDs(body string) []string {
	var ids []string
	for _, line := range strings.Split(body, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch key {
		case "ID":
			ids = append([]string{strings.ToLower(value)}, ids...)
		case "ID_LIKE":
			for _, like := range strings.Fields(strings.ToLower(value)) {
				ids = append(ids, like)
			}
		}
	}
	return ids
}

// Node.js and Adoptium use x64/arm64; other architectures have no tarball recipe.
func HostArch() (string, bool) {
	switch runtime.GOARCH {
	case "amd64":
		return "x64", true
	case "arm64":
		return "arm64", true
	default:
		return "", false
	}
}

// System installs require root on Alpine. Prefer kiao-dev: its declaration survives
// container recreation, unlike bare apk installs.
func SystemInstaller(platform string) ([]string, []string, bool) {
	if platform != toolcatalog.PlatformAlpine || os.Geteuid() != 0 {
		return nil, nil, false
	}
	if path, err := exec.LookPath("kiao-dev"); err == nil {
		return []string{path, "add"}, []string{path, "del"}, true
	}
	if path, err := exec.LookPath("apk"); err == nil {
		return []string{path, "add", "--no-cache"}, []string{path, "del"}, true
	}
	return nil, nil, false
}
