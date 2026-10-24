package runnerhttp

import (
	agentapi "kiao/worker/internal/hybridflow-runner/agents"
	"testing"
)

func TestSettleBackgroundAbandonsOpenWork(t *testing.T) {
	tasks := []agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: agentapi.BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "manualReconciliation", State: agentapi.BackgroundWaiting},
		{ID: "c", Kind: "subagent", Label: `subagent "done"`, Status: "completed", State: agentapi.BackgroundFinished},
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: agentapi.BackgroundRunning,
			Children: []agentapi.BackgroundChild{
				{ChildID: "one", Label: "one", Status: "running", State: agentapi.BackgroundRunning},
				{ChildID: "two", Label: "two", Status: "completed", State: agentapi.BackgroundFinished, Terminal: "completed"},
			}},
	}
	got := agentapi.SettleBackground(tasks)
	// Open work is finished-and-abandoned, in the service's own word: the wait
	// is over, and the last word from the host would be a lie if it stood.
	for _, id := range []string{"a", "b"} {
		var found *agentapi.BackgroundTask
		for i := range got {
			if got[i].ID == id {
				found = &got[i]
			}
		}
		if found == nil {
			t.Fatalf("settled roster = %+v, want task %q kept", got, id)
		}
		if found.State != agentapi.BackgroundFinished || found.Status != agentapi.BackgroundAbandoned {
			t.Errorf("task %q = %q/%q, want finished/abandoned", id, found.State, found.Status)
		}
	}
	// What landed keeps its verdict: settling is about the wait, not the work.
	if got[2].State != agentapi.BackgroundFinished || got[2].Status != "completed" {
		t.Errorf("finished task = %+v, want its verdict kept", got[2])
	}
	// Children settle like their parent: the open one is abandoned, the landed
	// one keeps its terminal.
	children := got[3].Children
	if len(children) != 2 {
		t.Fatalf("workflow children = %+v, want both kept", children)
	}
	if children[0].State != agentapi.BackgroundFinished || children[0].Status != agentapi.BackgroundAbandoned {
		t.Errorf("open child = %+v, want finished/abandoned", children[0])
	}
	if children[1].State != agentapi.BackgroundFinished || children[1].Status != "completed" {
		t.Errorf("landed child = %+v, want its verdict kept", children[1])
	}
	// Answered as a copy: settling must not rewrite the rows it was handed,
	// which may still alias the driver's own hold on the roster.
	if tasks[0].State != agentapi.BackgroundRunning || tasks[0].Status != "running" {
		t.Errorf("input task = %+v, want it untouched", tasks[0])
	}
	if tasks[3].Children[0].State != agentapi.BackgroundRunning {
		t.Errorf("input child = %+v, want it untouched", tasks[3].Children[0])
	}
}

func TestSettleBackgroundKeepsAnEmptyRoster(t *testing.T) {
	if got := agentapi.SettleBackground(nil); got != nil {
		t.Errorf("settleBackground(nil) = %+v, want nil", got)
	}
	if got := agentapi.SettleBackground([]agentapi.BackgroundTask{}); len(got) != 0 {
		t.Errorf("settleBackground([]) = %+v, want empty", got)
	}
}

func TestBackgroundTaskEqual(t *testing.T) {
	base := agentapi.BackgroundTask{ID: "a", Kind: "subagent", Label: "x", Status: "running", State: agentapi.BackgroundRunning}
	same := base
	if !agentapi.BackgroundTaskEqual(base, same) {
		t.Error("equal rows compare unequal")
	}
	for name, mutate := range map[string]func(*agentapi.BackgroundTask){
		"kind":   func(task *agentapi.BackgroundTask) { task.Kind = "workflow" },
		"label":  func(task *agentapi.BackgroundTask) { task.Label = "y" },
		"status": func(task *agentapi.BackgroundTask) { task.Status = "resultReady" },
		"state":  func(task *agentapi.BackgroundTask) { task.State = agentapi.BackgroundFinished },
	} {
		other := base
		mutate(&other)
		if agentapi.BackgroundTaskEqual(base, other) {
			t.Errorf("rows differing by %s compare equal", name)
		}
	}
	withChild := base
	withChild.Children = []agentapi.BackgroundChild{{ChildID: "one", Status: "running", State: agentapi.BackgroundRunning}}
	if agentapi.BackgroundTaskEqual(base, withChild) {
		t.Error("a row that gained a child compares equal")
	}
	movedChild := withChild
	movedChild.Children = []agentapi.BackgroundChild{{ChildID: "one", Status: "completed", State: agentapi.BackgroundFinished}}
	if agentapi.BackgroundTaskEqual(withChild, movedChild) {
		t.Error("a row whose child moved compares equal")
	}
}

func TestWireBackgroundCarriesTasksAndChildren(t *testing.T) {
	frame := agentapi.WireBackground([]agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: agentapi.BackgroundRunning},
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: agentapi.BackgroundRunning,
			Children: []agentapi.BackgroundChild{
				{ChildID: "one", Label: "one", Status: "completed", State: agentapi.BackgroundFinished, Terminal: "completed"},
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
	if frame := agentapi.WireBackground(nil); frame == nil || len(frame) != 0 {
		t.Errorf("wireBackground(nil) = %v, want an empty list", frame)
	}
}

func TestBackgroundFrameReplacesTheRoster(t *testing.T) {
	w := newBlockWatcher(t)
	w.hub.Apply(w.job, agentapi.AgentEvent{Kind: agentapi.EventBackground, Background: []agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: agentapi.BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "completed", State: agentapi.BackgroundFinished},
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
	w.hub.Apply(w.job, agentapi.AgentEvent{Kind: agentapi.EventBackground, Background: []agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "completed", State: agentapi.BackgroundFinished},
	}})
	msg = readFrame(t, w.conn)
	if tasks, _ := msg["tasks"].([]any); len(tasks) != 1 {
		t.Fatalf("tasks = %v, want the roster replaced, not extended", msg["tasks"])
	}
	if len(w.job.Background) != 1 || w.job.Background[0].State != agentapi.BackgroundFinished {
		t.Errorf("held roster = %+v, want the latest event's", w.job.Background)
	}
}

func TestSyncReplaysTheRoster(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	h.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventBackground, Background: []agentapi.BackgroundTask{
		{ID: "w", Kind: "workflow", Label: `workflow "nightly"`, Status: "inProgress", State: agentapi.BackgroundRunning,
			Children: []agentapi.BackgroundChild{
				{ChildID: "one", Label: "one", Status: "manualReconciliation", State: agentapi.BackgroundWaiting},
			}},
	}})
	frame := h.SyncFrame(job)
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
	h.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventBackground, Background: []agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "running", State: agentapi.BackgroundRunning},
		{ID: "b", Kind: "subagent", Label: `subagent "writer"`, Status: "manualReconciliation", State: agentapi.BackgroundWaiting},
		{ID: "c", Kind: "subagent", Label: `subagent "done"`, Status: "completed", State: agentapi.BackgroundFinished},
	}})
	h.FinishTurn(job, 0, false)
	if len(job.Background) != 3 {
		t.Fatalf("settled roster = %+v, want every row kept", job.Background)
	}
	for _, task := range job.Background[:2] {
		if task.State != agentapi.BackgroundFinished || task.Status != agentapi.BackgroundAbandoned {
			t.Errorf("task %q = %+v, want it finished-and-abandoned", task.ID, task)
		}
	}
	if kept := job.Background[2]; kept.Status != "completed" {
		t.Errorf("landed task = %+v, want its verdict kept", kept)
	}
	// A resync replays the settle: the wait reads as over, not as running.
	frame := h.SyncFrame(job)
	tasks, _ := frame["background"].([]map[string]any)
	if len(tasks) != 3 || tasks[0]["status"] != agentapi.BackgroundAbandoned {
		t.Errorf("background = %v, want the settled roster", frame["background"])
	}
}

func TestBackgroundAfterTheTurnEndedIsDropped(t *testing.T) {
	h, job, _ := newPermissionTestJob()
	h.FinishTurn(job, 0, false)
	h.Apply(job, agentapi.AgentEvent{Kind: agentapi.EventBackground, Background: []agentapi.BackgroundTask{
		{ID: "a", Kind: "subagent", Label: `subagent "scout"`, Status: "inProgress", State: agentapi.BackgroundRunning},
	}})
	if len(job.Background) != 0 {
		t.Errorf("held roster = %+v, want the straggler dropped: the settle is the last word", job.Background)
	}
}
