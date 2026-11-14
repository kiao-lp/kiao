package runnerhttp

import (
	"kiao/skills"
	pkgSkills "kiao/worker/internal/hybridflow-runner/skills"
	"testing"
	"testing/fstest"
)

// mustInstall installs a skill into the .agents target and fails the test on error, returning what
// it took. The rules the tests below are about — the marker, the two digests, the prune — are the
// two targets' shared half, so they are exercised through one of them; what is each directory's own
// is which CLI reads it, which no test here can observe.
func mustInstall(t *testing.T, root string, skill skills.Skill) pkgSkills.SkillOutcome {
	t.Helper()
	outcome, err := pkgSkills.InstallSkill(pkgSkills.AgentsSkillTarget(root), skill)
	if err != nil {
		t.Fatalf("installSkill(%s): %v", skill.Name, err)
	}
	return outcome
}

// bundleOf builds a skill the way the embedded one looks, without needing the real bundle.
func bundleOf(name string, files map[string]string) skills.Skill {
	tree := fstest.MapFS{}
	for path, content := range files {
		tree[path] = &fstest.MapFile{Data: []byte(content)}
	}
	return skills.Skill{Name: name, Source: "reference/kiao-skills/" + name + "/", Files: tree}
}
