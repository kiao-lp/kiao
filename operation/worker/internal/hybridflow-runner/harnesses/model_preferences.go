package harnesses

import (
	"encoding/json"
	"fmt"
	"kiao/worker/internal/core/errors"
	"kiao/worker/internal/core/filesystem"
	"kiao/worker/internal/hybridflow-runner/harnesses/protocol"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

type ModelPreferences struct {
	ActiveModels []string `json:"activeModels"`
	DefaultModel string   `json:"defaultModel"`
}

type ModelConfiguration struct {
	Models []HarnessOption `json:"models"`
	ModelPreferences
}

func (r *HarnessRegistry) ModelConfiguration(entry HarnessEntry, options HarnessOptionsDto) (ModelConfiguration, error) {
	saved, err := r.readModelPreferences(entry.Name)
	preferred, _ := entryDefaults(entry, options)
	models := options.Models
	if models == nil {
		models = []HarnessOption{}
	}
	return ModelConfiguration{Models: models, ModelPreferences: effectiveModelPreferences(entry.Name, models, preferred, saved)}, err
}

func (r *HarnessRegistry) SaveModelPreferences(entry HarnessEntry, models []HarnessOption, prefs ModelPreferences) error {
	if r.ModelPreferencesDir == "" {
		return fmt.Errorf("no store directory for harness model preferences")
	}
	if err := validateModelPreferences(prefs, models); err != nil {
		return err
	}
	if err := os.MkdirAll(r.ModelPreferencesDir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	return filesystem.WriteFileAtomic(r.modelPreferencesPath(entry.Name), append(data, '\n'), 0o600)
}

func (r *HarnessRegistry) modelPreferencesPath(harness string) string {
	return filepath.Join(r.ModelPreferencesDir, harness+".json")
}

func (r *HarnessRegistry) readModelPreferences(harness string) (ModelPreferences, error) {
	if r.ModelPreferencesDir == "" {
		return ModelPreferences{}, nil
	}
	data, err := os.ReadFile(r.modelPreferencesPath(harness))
	if os.IsNotExist(err) {
		return ModelPreferences{}, nil
	}
	if err != nil {
		return ModelPreferences{}, err
	}
	var prefs ModelPreferences
	if err := json.Unmarshal(data, &prefs); err != nil {
		return ModelPreferences{}, err
	}
	return prefs, nil
}

func validateModelPreferences(prefs ModelPreferences, models []HarnessOption) error {
	if prefs.DefaultModel == "" || !slices.Contains(prefs.ActiveModels, prefs.DefaultModel) {
		return faults.Invalid("choose an active model as the default")
	}
	seen := make(map[string]bool, len(prefs.ActiveModels))
	for _, id := range prefs.ActiveModels {
		if seen[id] || !HasHarnessOption(models, id) {
			return faults.Invalid("choose distinct models from the current harness catalogue")
		}
		seen[id] = true
	}
	return nil
}

// Keep stored IDs on disk when the CLI stops listing them. Fall back using the current catalogue.
func effectiveModelPreferences(harness string, models []HarnessOption, preferred string, saved ModelPreferences) ModelPreferences {
	active := []string{}
	for _, id := range saved.ActiveModels {
		if HasHarnessOption(models, id) && !slices.Contains(active, id) {
			active = append(active, id)
		}
	}
	if len(active) == 0 {
		active = initialModels(harness, models, preferred)
	}
	for _, id := range []string{saved.DefaultModel, preferred} {
		if slices.Contains(active, id) {
			return ModelPreferences{ActiveModels: active, DefaultModel: id}
		}
	}
	prefs := ModelPreferences{ActiveModels: active}
	if len(active) > 0 {
		prefs.DefaultModel = active[0]
	}
	return prefs
}

func initialModels(harness string, models []HarnessOption, preferred string) []string {
	active := []string{}
	groups := map[string]bool{}
	if HasHarnessOption(models, preferred) {
		active = append(active, preferred)
		groups[initialModelGroup(harness, preferred)] = true
	}
	if harness == HarnessMuse {
		models = slices.Clone(models)
		slices.SortStableFunc(models, func(a, b HarnessOption) int {
			return CompareMuseVersions(initialMuseVersion(b.Value), initialMuseVersion(a.Value))
		})
	}
	for _, model := range models {
		if len(active) == 3 {
			break
		}
		group := initialModelGroup(harness, model.Value)
		if groups[group] || (harness == HarnessCodex && group != model.Value) {
			continue
		}
		groups[group] = true
		active = append(active, model.Value)
	}
	return active
}

func initialModelGroup(harness, id string) string {
	switch harness {
	case HarnessCodex:
		model, _, _ := strings.Cut(id, "@")
		return model
	case HarnessMuse:
		if matched := MuseModelRe.FindStringSubmatch(id); matched != nil {
			return matched[1] + matched[3]
		}
	}
	return id
}

func initialMuseVersion(id string) string {
	if matched := MuseModelRe.FindStringSubmatch(id); matched != nil {
		return matched[2]
	}
	return ""
}

func entryDefaults(entry HarnessEntry, options HarnessOptionsDto) (model, effort string) {
	model = protocol.OrDefault(entry.Model, options.DefaultModel)
	effort = protocol.OrDefault(entry.Effort, options.DefaultEffort)
	if entry.Name == HarnessMuse {
		model = protocol.OrDefault(model, DefaultMuseModel(options.Models))
		effort = protocol.OrDefault(effort, DefaultMuseEffort(options.Efforts))
	}
	return model, effort
}

func DefaultEffortFor(entry HarnessEntry, options HarnessOptionsDto, model string) string {
	_, fallback := entryDefaults(entry, options)
	choice, ok := FindHarnessOption(options.Models, model)
	switch {
	case !ok || len(choice.Efforts) == 0:
		return fallback
	case model == options.DefaultModel && HasHarnessOption(choice.Efforts, fallback):
		return fallback
	case HasHarnessOption(choice.Efforts, choice.DefaultEffort):
		return choice.DefaultEffort
	case HasHarnessOption(choice.Efforts, fallback):
		return fallback
	default:
		return choice.Efforts[0].Value
	}
}
