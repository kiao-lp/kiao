package install

import (
	"fmt"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
)

// installSystem hands the packages to apk, through kiao-dev when it is there so that the install
// is written to the declaration the container replays at every start. Reachable only where the
// process is root and the platform has a recipe for it, which today is the `kiao` image alone.
func (in *installer) installSystem(recipe toolcatalog.Recipe) (string, error) {
	add, _, ok := toolconfig.SystemInstaller(in.cfg.Platform())
	if !ok {
		return "", fmt.Errorf("this system has no package manager this service may use")
	}
	if err := in.run(append(add, recipe.Packages...), in.cfg.Prefix); err != nil {
		return "", err
	}
	if recipe.Bin != "" {
		return in.versionOf(recipe.Bin, "--version")
	}
	return "", nil
}
