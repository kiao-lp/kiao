package scope

import (
	"strings"
)

// Search excludes hidden directories (including git and service state) and node_modules
// even when .kiao-files declares no exclusions.
func SkipMachineryDir(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules"
}
