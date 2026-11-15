package search

import (
	"kiao/worker/internal/core/filesystem"
)

type Searcher struct{ storage *filesystem.Storage }

func NewSearcher(storage *filesystem.Storage) *Searcher { return &Searcher{storage: storage} }
