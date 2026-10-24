package services

import (
	"context"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// Runners is the runner half of the core: the machines that play cards.
//
// What it does **not** do is play one — a runner is a worker on another host, and this half
// never sees it except in the heartbeat it calls in with. This half keeps the definitions: which
// runners there are, what they are called, and when each was last heard from — which is what a
// task pinned to one is checked against, and what the panel draws.
type Runners struct {
	repo  ports.RunnerRepository
	clock ports.Clock
	ids   ports.IDs
}

func NewRunners(repo ports.RunnerRepository, clock ports.Clock, ids ports.IDs) *Runners {
	return &Runners{repo: repo, clock: clock, ids: ids}
}

// NewRunnerRequest is one runner to be filed. The name is what makes it one; last seen is the
// runner's own to say, in its first heartbeat, so a filed runner starts out never heard from.
type NewRunnerRequest struct {
	Name string
}

// Create files a runner. The id is minted here: nothing draws a runner before it exists, so unlike
// a card's it is never the client's to choose.
func (r *Runners) Create(ctx context.Context, req NewRunnerRequest, actor string) (*entities.Runner, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, entities.Invalidf("a runner has a name")
	}
	now := r.clock.Now()
	runner := &entities.Runner{
		ID: r.ids.NewID(), Name: name,
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	if err := r.repo.CreateRunner(ctx, runner, actor); err != nil {
		return nil, err
	}
	return runner, nil
}

// List is every runner, by name: what the panel lists and the task editor picks from.
func (r *Runners) List(ctx context.Context) ([]entities.Runner, error) {
	return r.repo.ListRunners(ctx)
}

// Find is one runner, by id.
func (r *Runners) Find(ctx context.Context, id string) (*entities.Runner, error) {
	return r.repo.FindRunner(ctx, id)
}

// Patch changes the fields the patch names. A name emptied is refused rather than written: a
// runner must stay a thing a task can name.
func (r *Runners) Patch(ctx context.Context, id string, patch entities.RunnerPatch, expected *int64, actor string) (*entities.Runner, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		if name == "" {
			return nil, entities.Invalidf("a runner keeps a name")
		}
		patch.Name = &name
	}
	return r.repo.PatchRunner(ctx, id, patch, expected, actor)
}

// Delete removes a runner. The tasks naming it are left as they are: they still say which runner
// they wanted, and the next play says it is gone rather than failing on a reference nobody can
// see.
func (r *Runners) Delete(ctx context.Context, id string, actor string) error {
	return r.repo.DeleteRunner(ctx, id, actor)
}

// Heartbeat records that the runner is alive: it stamps last seen with now. Called by the
// runner's own process every few seconds, so a panel read any time says which runners are up.
func (r *Runners) Heartbeat(ctx context.Context, id string, actor string) (*entities.Runner, error) {
	return r.repo.Heartbeat(ctx, id, r.clock.Now(), actor)
}
