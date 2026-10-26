package events

import (
	"sync"
)

type Subscriptions struct {
	mu    *sync.Mutex
	subs  map[string]map[string]*Client
	Conns map[string]*Client
}

func NewSubscriptions(mu *sync.Mutex) *Subscriptions {
	return &Subscriptions{mu: mu, subs: map[string]map[string]*Client{}, Conns: map[string]*Client{}}
}
