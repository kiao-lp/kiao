package agents

// BackgroundState is the service-defined lane; Status retains the host vocabulary.
type BackgroundState string

const BackgroundRunning BackgroundState = "running"

// BackgroundWaiting requires owner input to reconcile a task that ended without a result.
const BackgroundWaiting BackgroundState = "waiting"

// BackgroundFinished includes completed tasks and tasks abandoned at turn end.
const BackgroundFinished BackgroundState = "finished"

// backgroundAbandoned replaces the host status of tasks still open at turn end.
const BackgroundAbandoned = "abandoned"

// BackgroundChild is a workflow child. Terminal is completed, failed or cancelled;
// it is empty until the child reaches a terminal state.
type BackgroundChild struct {
	ChildID  string
	Label    string
	Status   string
	State    BackgroundState
	Terminal string
}

// BackgroundTask is a live workflow, delegation or background tool call.
// Status is the host status; State is the service lane. Only workflows have Children.
type BackgroundTask struct {
	ID       string
	Kind     string
	Label    string
	Status   string
	State    BackgroundState
	Children []BackgroundChild
}

func BackgroundTaskEqual(a, b BackgroundTask) bool {
	if a.ID != b.ID || a.Kind != b.Kind || a.Label != b.Label ||
		a.Status != b.Status || a.State != b.State || len(a.Children) != len(b.Children) {
		return false
	}
	for i := range a.Children {
		if a.Children[i] != b.Children[i] {
			return false
		}
	}
	return true
}

// settleBackground marks unfinished tasks and children finished-and-abandoned so
// sync cannot replay stale running work. Called by finishTurn for every termination.
// It copies rows and children to avoid mutating the driver-owned roster.
func SettleBackground(tasks []BackgroundTask) []BackgroundTask {
	if len(tasks) == 0 {
		return tasks
	}
	out := make([]BackgroundTask, len(tasks))
	for i, task := range tasks {
		out[i] = task
		if out[i].State != BackgroundFinished {
			out[i].State = BackgroundFinished
			out[i].Status = BackgroundAbandoned
		}
		if len(task.Children) == 0 {
			continue
		}
		children := make([]BackgroundChild, len(task.Children))
		copy(children, task.Children)
		for j := range children {
			if children[j].State != BackgroundFinished {
				children[j].State = BackgroundFinished
				children[j].Status = BackgroundAbandoned
			}
		}
		out[i].Children = children
	}
	return out
}

func wireBackgroundChild(child BackgroundChild) map[string]any {
	frame := map[string]any{
		"childId": child.ChildID,
		"status":  child.Status,
		"state":   string(child.State),
	}
	if child.Label != "" {
		frame["label"] = child.Label
	}
	if child.Terminal != "" {
		frame["terminal"] = child.Terminal
	}
	return frame
}

func wireBackgroundTask(task BackgroundTask) map[string]any {
	frame := map[string]any{
		"id": task.ID, "kind": task.Kind, "label": task.Label,
		"status": task.Status, "state": string(task.State),
	}
	if len(task.Children) > 0 {
		children := make([]map[string]any, 0, len(task.Children))
		for _, child := range task.Children {
			children = append(children, wireBackgroundChild(child))
		}
		frame["children"] = children
	}
	return frame
}

// wireBackground preserves handoff order and returns an empty list, never nil.
func WireBackground(tasks []BackgroundTask) []map[string]any {
	out := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		out = append(out, wireBackgroundTask(task))
	}
	return out
}
