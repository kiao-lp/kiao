package postgres

import (
	"context"
	"testing"
	"time"
)

func TestTimedOutClientsLeaveNoWaiters(t *testing.T) {
	changes := NewChangeStore(nil)
	changes.setListening(true)
	for range 10 {
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		woken := changes.Await(ctx, 0)
		cancel()
		if woken {
			t.Fatal("an idle client was woken without a change")
		}
	}
	if len(changes.waiters) != 0 {
		t.Fatal("timed out clients are retained while the board is idle")
	}
}

func TestDroppingTheChangeListenerWakesAWaiter(t *testing.T) {
	changes := NewChangeStore(nil)
	changes.setListening(true)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() {
		time.Sleep(30 * time.Millisecond)
		changes.setListening(false)
	}()
	if !changes.Await(ctx, 0) {
		t.Fatal("a dropped listener left the client waiting")
	}
}
