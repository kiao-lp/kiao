package agents

import (
	"regexp"
	"strconv"
	"strings"
)

// Muse IDs may have a provider prefix and contributor suffix. Spark and Wonder are the
// families the channel has published; there is no latest alias, so compare captured
// versions to choose the default.
var MuseModelRe = regexp.MustCompile(`^(?:[^/]+/)?muse-(spark|wonder)-(\d+(?:\.\d+)*)(-contributor)?$`)

// Kept for callers that named the Spark-only spelling; it matches what museModelRe does.
var sparkModelRe = MuseModelRe

// defaultMuseModel prefers the newest contributor build, then the newest Muse model.
// Empty delegates to the caller's first option or the host default.
func DefaultMuseModel(models []AgentOption) string {
	if newest := NewestMuseModel(models, true); newest != "" {
		return newest
	}
	return NewestMuseModel(models, false)
}

// defaultMuseModelWithDefault prefers the catalogue's isDefault row (and its contributor
// twin where offered), falling back to the newest contributor and then the newest model.
// Empty delegates to the caller's first option or the host default.
func DefaultMuseModelWithDefault(models []AgentOption, defaultID string) string {
	if id := strings.TrimSpace(defaultID); id != "" {
		listed := make(map[string]bool, len(models))
		for _, model := range models {
			listed[model.Value] = true
		}
		if twin := id + "-contributor"; listed[twin] {
			return twin
		}
		if listed[id] {
			return id
		}
		// The default may carry a provider prefix the offered list omits, or vice versa:
		// match on the bare model ID before falling back to the newest.
		if bare := museBareID(id); bare != "" {
			if twin := bare + "-contributor"; listed[twin] {
				return twin
			}
			if listed[bare] {
				return bare
			}
			for _, model := range models {
				if museBareID(model.Value) == bare {
					// Prefer the contributor build where the catalogue names the plain ID.
					if twin := model.Value + "-contributor"; listed[twin] {
						return twin
					}
					return model.Value
				}
			}
		}
	}
	return DefaultMuseModel(models)
}

// museBareID strips a provider prefix (meta/muse-spark-1.3 -> muse-spark-1.3).
// Empty where the ID is not a Muse model.
func museBareID(id string) string {
	matched := MuseModelRe.FindStringSubmatch(strings.TrimSpace(id))
	if matched == nil {
		return ""
	}
	bare := "muse-" + matched[1] + "-" + matched[2]
	if matched[3] != "" {
		bare += matched[3]
	}
	return bare
}

// Equal versions retain catalogue order.
func NewestMuseModel(models []AgentOption, contributorOnly bool) string {
	newest := ""
	for _, model := range models {
		matched := MuseModelRe.FindStringSubmatch(model.Value)
		if matched == nil {
			continue
		}
		if contributorOnly && matched[3] == "" {
			continue
		}
		if newest == "" || CompareMuseVersions(matched[2], museVersionOf(newest)) > 0 {
			newest = model.Value
		}
	}
	return newest
}

// The caller must supply an ID matched by museModelRe.
func museVersionOf(id string) string {
	return MuseModelRe.FindStringSubmatch(id)[2]
}

func CompareMuseVersions(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			vb, _ = strconv.Atoi(pb[i])
		}
		if va != vb {
			if va < vb {
				return -1
			}
			return 1
		}
	}
	return 0
}

func DefaultMuseEffort(efforts []AgentOption) string {
	for _, effort := range efforts {
		if effort.Value == "max" {
			return "max"
		}
	}
	return ""
}
