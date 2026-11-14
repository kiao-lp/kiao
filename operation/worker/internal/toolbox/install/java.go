package install

import (
	"fmt"
	toolcatalog "kiao/worker/internal/toolbox/catalog"
	toolconfig "kiao/worker/internal/toolbox/config"
	"os"
	"path/filepath"
)

// adoptiumLatest is the API that answers, for a feature release, the current GA binary and its
// checksum. Asking it is what makes "the JDK" a moving target the panel keeps up with rather than
// a URL that rots in the catalogue.
const adoptiumLatest = "https://api.adoptium.net/v3/assets/latest/%s/hotspot?os=linux&architecture=%s&image_type=jdk"

// installTemurin fetches the Eclipse Temurin JDK and unpacks it as <prefix>/java.
func (in *installer) installTemurin(recipe toolcatalog.Recipe) (string, error) {
	arch, ok := toolconfig.HostArch()
	if !ok {
		return "", fmt.Errorf("no Temurin build is published for this machine's architecture")
	}

	var assets []struct {
		ReleaseName string `json:"release_name"`
		Binary      struct {
			Package struct {
				Link     string `json:"link"`
				Name     string `json:"name"`
				Checksum string `json:"checksum"`
			} `json:"package"`
		} `json:"binary"`
	}
	if err := in.getJSON(fmt.Sprintf(adoptiumLatest, recipe.Version, arch), &assets); err != nil {
		return "", err
	}
	if len(assets) == 0 || assets[0].Binary.Package.Link == "" {
		return "", fmt.Errorf("Adoptium publishes no JDK %s for linux/%s", recipe.Version, arch)
	}
	pkg := assets[0].Binary.Package
	in.log.printf("Adoptium's current JDK %s is %s", recipe.Version, assets[0].ReleaseName)

	archive := filepath.Join(in.cfg.DownloadDir(), pkg.Name)
	if err := in.download(pkg.Link, archive, pkg.Checksum); err != nil {
		return "", err
	}
	defer os.Remove(archive)

	if err := in.unpackInto(archive, in.cfg.JavaDir()); err != nil {
		return "", err
	}
	return in.versionOf(filepath.Join(in.cfg.JavaDir(), "bin", "java"), "--version")
}
