// Package services is the business logic: what the rules are, expressed against the ports and
// against nothing else. No SQL, no HTTP, no driver — which is what lets every rule below be tested
// against a repository held in a map.
package services

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"kiao/hybridflow-store/core/entities"
	"kiao/hybridflow-store/core/ports"
)

// slugUnsafe is everything a URL handle does not keep. The handle is deliberately narrower than a
// file name was: a board used to be named by its path, so its name had to survive a filesystem;
// now it is named by a slug, which has to survive being typed, mailed and pasted.
var slugUnsafe = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify is the handle a name is reached by. It is lossy on purpose — case, accents and
// punctuation all go — which is why it is checked for collisions rather than trusted to be unique
// by construction.
func Slugify(name string) string {
	slug := slugUnsafe.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		// A board named entirely in a script this rule strips — and a board may be named anything —
		// still needs a handle. "board" plus the collision suffix below is one.
		return "board"
	}
	if len(slug) > 60 {
		slug = strings.Trim(slug[:60], "-")
	}
	return slug
}

// Boards is the board half of the core.
type Boards struct {
	repo  ports.BoardRepository
	clock ports.Clock
	ids   ports.IDs
}

// NewBoards wires the half. Every dependency is a port: nothing here can reach a database even by
// accident.
func NewBoards(repo ports.BoardRepository, clock ports.Clock, ids ports.IDs) *Boards {
	return &Boards{repo: repo, clock: clock, ids: ids}
}

// NewBoardRequest is what creating a board asks for.
type NewBoardRequest struct {
	Name string
}

// Create makes a board. The slug is derived from the name and made unique by suffix, so two boards
// may not be called the same thing but a name that slugs onto an existing handle is still accepted.
func (b *Boards) Create(ctx context.Context, req NewBoardRequest, actor string) (*entities.Board, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, entities.Invalidf("a board is created with a name")
	}
	now := b.clock.Now()
	board := &entities.Board{
		ID: b.ids.NewID(), Name: name,
		CreatedAt: now, UpdatedAt: now, Revision: 1,
	}
	// The slug is unique in the database, so a collision comes back as one and is answered by
	// trying the next suffix rather than by asking the caller to pick another name. Bounded,
	// because a loop that cannot end is worse than a name that cannot be had.
	base := Slugify(name)
	for attempt := 0; attempt < 50; attempt++ {
		board.Slug = base
		if attempt > 0 {
			board.Slug = base + "-" + strconv.Itoa(attempt+1)
		}
		err := b.repo.CreateBoard(ctx, board, actor)
		switch {
		case err == nil:
			return board, nil
		case errors.Is(err, entities.ErrNameTaken):
			// The *name* is taken, not the handle: two boards called the same thing would be two
			// entries of the boards page nobody can tell apart.
			return nil, err
		case errors.Is(err, entities.ErrConflict):
			continue // the handle is taken; try the next suffix
		default:
			return nil, err
		}
	}
	return nil, fmt.Errorf("could not find a free handle for %q: %w", name, entities.ErrConflict)
}

// List is every board, for the page that lists them.
func (b *Boards) List(ctx context.Context, includeArchived bool) ([]entities.Board, error) {
	return b.repo.ListBoards(ctx, ports.BoardFilter{IncludeArchived: includeArchived})
}

// Find is one board, by id or by slug. **Both, through one call**, because the
// client that has a URL holds a slug and the client that has a card holds an id, and neither should
// have to know which the other uses.
func (b *Boards) Find(ctx context.Context, handle string) (*entities.Board, error) {
	board, err := b.repo.FindBoard(ctx, handle)
	if err == nil {
		return board, nil
	}
	if !errors.Is(err, entities.ErrNotFound) {
		return nil, err
	}
	return b.repo.FindBoardBySlug(ctx, handle)
}

// Patch changes the board itself. A rename does **not** move the slug: the handle is what a URL, a
// bookmark and a pasted link hold, and a board renamed from "Major" to "Majeur" is the same board
// at the same address. A handle is changed by asking for it, which nothing asks for yet.
func (b *Boards) Patch(ctx context.Context, handle string, patch entities.BoardPatch, expected *int64, actor string) (*entities.Board, error) {
	if patch.Empty() {
		return nil, entities.Invalidf("the patch changes nothing")
	}
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		if name == "" {
			return nil, entities.Invalidf("a board keeps a name")
		}
		patch.Name = &name
	}
	board, err := b.Find(ctx, handle)
	if err != nil {
		return nil, err
	}
	return b.repo.PatchBoard(ctx, board.ID, patch, expected, actor)
}

// Delete takes the board and everything on it.
func (b *Boards) Delete(ctx context.Context, handle string, actor string) error {
	board, err := b.Find(ctx, handle)
	if err != nil {
		return err
	}
	return b.repo.DeleteBoard(ctx, board.ID, actor)
}
