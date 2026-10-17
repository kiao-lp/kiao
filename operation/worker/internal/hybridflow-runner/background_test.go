package hybridflowrunner

import "testing"

// The background roster: settling it at the turn's end, comparing rows, and
// carrying it on the wire.

func TestSettleBackgroundAbandonsOpenWork(t *testing.T) {
	tasks := []BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "manualReconciliation", State: BackgroundWaiting},
		{ID: "c", Kind: "subagent", Label: `subagent "done"`, Status: "completed", State: BackgroundFinished},
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: BackgroundRunning,
			Children: []BackgroundChild{
				{ChildID: "one", Label: "one", Status: "running", State: BackgroundRunning},
				{ChildID: "two", Label: "two", Status: "completed", State: BackgroundFinished, Terminal: "completed"},
			}},
	}
	got := settleBackground(tasks)
	// Open work is finished-and-abandoned, in the service's own word: the wait
	// is over, and the last word from the host would be a lie if it stood.
	for _, id := range []string{"a", "b"} {
		var found *BackgroundTask
		for i := range got {
			if got[i].ID == id {
				found = &got[i]
			}
		}
		if found == nil {
			t.Fatalf("settled roster = %+v, want task %q kept", got, id)
		}
		if found.State != BackgroundFinished || found.Status != backgroundAbandoned {
			t.Errorf("task %q = %q/%q, want finished/abandoned", id, found.State, found.Status)
		}
	}
	// What landed keeps its verdict: settling is about the wait, not the work.
	if got[2].State != BackgroundFinished || got[2].Status != "completed" {
		t.Errorf("finished task = %+v, want its verdict kept", got[2])
	}
	// Children settle like their parent: the open one is abandoned, the landed
	// one keeps its terminal.
	children := got[3].Children
	if len(children) != 2 {
		t.Fatalf("workflow children = %+v, want both kept", children)
	}
	if children[0].State != BackgroundFinished || children[0].Status != backgroundAbandoned {
		t.Errorf("open child = %+v, want finished/abandoned", children[0])
	}
	if children[1].State != BackgroundFinished || children[1].Status != "completed" {
		t.Errorf("landed child = %+v, want its verdict kept", children[1])
	}
	// Answered as a copy: settling must not rewrite the rows it was handed,
	// which may still alias the driver's own hold on the roster.
	if tasks[0].State != BackgroundRunning || tasks[0].Status != "running" {
		t.Errorf("input task = %+v, want it untouched", tasks[0])
	}
	if tasks[3].Children[0].State != BackgroundRunning {
		t.Errorf("input child = %+v, want it untouched", tasks[3].Children[0])
	}
}

func TestSettleBackgroundKeepsAnEmptyRoster(t *testing.T) {
	if got := settleBackground(nil); got != nil {
		t.Errorf("settleBackground(nil) = %+v, want nil", got)
	}
	if got := settleBackground([]BackgroundTask{}); len(got) != 0 {
		t.Errorf("settleBackground([]) = %+v, want empty", got)
	}
}

func TestBackgroundTaskEqual(t *testing.T) {
	base := BackgroundTask{ID: "a", Kind: "subagent", Label: "x", Status: "running", State: BackgroundRunning}
	same := base
	if !backgroundTaskEqual(base, same) {
		t.Error("equal rows compare unequal")
	}
	for name, mutate := range map[string]func(*BackgroundTask){
		"kind":   func(task *BackgroundTask) { task.Kind = "workflow" },
		"label":  func(task *BackgroundTask) { task.Label = "y" },
		"status": func(task *BackgroundTask) { task.Status = "resultReady" },
		"state":  func(task *BackgroundTask) { task.State = BackgroundFinished },
	} {
		other := base
		mutate(&other)
		if backgroundTaskEqual(base, other) {
			t.Errorf("rows differing by %s compare equal", name)
		}
	}
	withChild := base
	withChild.Children = []BackgroundChild{{ChildID: "one", Status: "running", State: BackgroundRunning}}
	if backgroundTaskEqual(base, withChild) {
		t.Error("a row that gained a child compares equal")
	}
	movedChild := withChild
	movedChild.Children = []BackgroundChild{{ChildID: "one", Status: "completed", State: BackgroundFinished}}
	if backgroundTaskEqual(withChild, movedChild) {
		t.Error("a row whose child moved compares equal")
	}
}

func TestWireBackgroundCarriesTasksAndChildren(t *testing.T) {
	frame := wireBackground([]BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: BackgroundRunning},
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: BackgroundRunning,
			Children: []BackgroundChild{
				{ChildID: "one", Label: "one", Status: "completed", State: BackgroundFinished, Terminal: "completed"},
			}},
	})
	if len(frame) != 2 {
		t.Fatalf("wireBackground = %v, want both tasks", frame)
	}
	first := frame[0]
	if first["id"] != "a" || first["kind"] != "subagent" || first["state"] != "running" {
		t.Errorf("first task = %v, want the roster row whole", first)
	}
	if _, hasChildren := first["children"]; hasChildren {
		t.Errorf("first task = %v, want no children where there are none", first)
	}
	children, _ := frame[1]["children"].([]map[string]any)
	if len(children) != 1 || children[0]["childId"] != "one" || children[0]["terminal"] != "completed" {
		t.Errorf("workflow children = %v, want the folded child whole", frame[1]["children"])
	}
}

func TestWireBackgroundIsNeverNil(t *testing.T) {
	if frame := wireBackground(nil); frame == nil || len(frame) != 0 {
		t.Errorf("wireBackground(nil) = %v, want an empty list", frame)
	}
}

// The hub holds the roster like it holds the turn's blocks — replaced whole on
// every event, replayed on `sync` — and settles it when the turn ends, so a
// resync replays the wait as over rather than as still running.

func TestBackgroundFrameReplacesTheRoster(t *testing.T) {
	w := newBlockWatcher(t)
	w.hub.apply(w.job, AgentEvent{Kind: agentBackground, Background: []BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "completed", State: BackgroundFinished},
	}})
	msg := readFrame(t, w.conn)
	if msg["type"] != "background" {
		t.Fatalf("frame = %v, want the roster", msg)
	}
	tasks, _ := msg["tasks"].([]any)
	if len(tasks) != 2 {
		t.Fatalf("tasks = %v, want both rows", msg["tasks"])
	}
	first, _ := tasks[0].(map[string]any)
	if first["id"] != "a" || first["state"] != "running" || first["label"] != `subagent "scout"` {
		t.Errorf("first row = %v, want the delegation whole", first)
	}
	// The next event supersedes the last: holding it is a replacement, and a
	// resubscribing tab is repaired by what the turn holds now.
	w.hub.apply(w.job, AgentEvent{Kind: agentBackground, Background: []BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "completed", State: BackgroundFinished},
	}})
	msg = readFrame(t, w.conn)
	if tasks, _ := msg["tasks"].([]any); len(tasks) != 1 {
		t.Fatalf("tasks = %v, want the roster replaced, not extended", msg["tasks"])
	}
	if len(w.job.background) != 1 || w.job.background[0].State != BackgroundFinished {
		t.Errorf("held roster = %+v, want the latest event's", w.job.background)
	}
}

func TestSyncReplaysTheRoster(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	h.apply(job, AgentEvent{Kind: agentBackground, Background: []BackgroundTask{
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: BackgroundRunning,
			Children: []BackgroundChild{
				{ChildID: "one", Label: "one", Status: "manualReconciliation", State: BackgroundWaiting},
			}},
	}})
	frame := h.syncFrame(job)
	tasks, _ := frame["background"].([]map[string]any)
	if len(tasks) != 1 || tasks[0]["id"] != "w" {
		t.Fatalf("background = %v, want the held roster", frame["background"])
	}
	children, _ := tasks[0]["children"].([]map[string]any)
	if len(children) != 1 || children[0]["state"] != "waiting" {
		t.Errorf("children = %v, want the parked child", tasks[0]["children"])
	}
}

func TestFinishTurnSettlesTheOpenRoster(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	h.apply(job, AgentEvent{Kind: agentBackground, Background: []BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "manualReconciliation", State: BackgroundWaiting},
		{ID: "c", Kind: "subagent", Label: `subagent "done"`, Status: "completed", State: BackgroundFinished},
	}})
	h.finishTurn(job, 0, false)
	if len(job.background) != 3 {
		t.Fatalf("settled roster = %+v, want every row kept", job.background)
	}
	for _, task := range job.background[:2] {
		if task.State != BackgroundFinished || task.Status != backgroundAbandoned {
			t.Errorf("task %q = %+v, want it finished-and-abandoned", task.ID, task)
		}
	}
	if kept := job.background[2]; kept.Status != "completed" {
		t.Errorf("landed task = %+v, want its verdict kept", kept)
	}
	// A resync replays the settle: the wait reads as over, not as running.
	frame := h.syncFrame(job)
	tasks, _ := frame["background"].([]map[string]any)
	if len(tasks) != 3 || tasks[0]["status"] != backgroundAbandoned {
		t.Errorf("background = %v, want the settled roster", frame["background"])
	}
}

func TestBackgroundAfterTheTurnEndedIsDropped(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	h.finishTurn(job, 0, false)
	h.apply(job, AgentEvent{Kind: agentBackground, Background: []BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "inProgress", State: BackgroundRunning},
	}})
	if len(job.background) != 0 {
		t.Errorf("held roster = %+v, want the straggler dropped: the settle is the last word", job.background)
	}
}
