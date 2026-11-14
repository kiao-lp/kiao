package configuration

import (
	"regexp"
)

var MigrationNameRe = regexp.MustCompile(`^V(\d+)__(.+)\.js$`)

type MigrationScript struct {
	Version  int
	Name     string
	FileName string
	Path     string
	Checksum string
}
