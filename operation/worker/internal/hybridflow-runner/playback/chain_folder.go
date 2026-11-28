package playback

import (
	"fmt"

	"kiao/worker/internal/core/filesystem"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
)

func (r *ChainRunner) renderTaskFolder(expression string, values pkgBoards.NodeContext) (string, error) {
	value, err := values.RenderField("working directory", expression)
	if err != nil {
		return "", err
	}
	if value == "" {
		return "", fmt.Errorf("the working directory reference resolved to an empty path")
	}
	folder, err := r.cfg.ResolveFolder(value)
	if err != nil {
		return "", fmt.Errorf("could not use the resolved working directory: %w", err)
	}
	return folder.Virtual, nil
}

func (r *ChainRunner) successorFolder(board *pkgBoards.BoardContent, node *pkgBoards.FlowNode) (string, error) {
	if !pkgBoards.HasContextReference(node.Settings.Folder) {
		return filesystem.NormaliseVirtual(node.Settings.WorkFolder()), nil
	}
	_, assignments, err := pkgBoards.WorkflowAssignments(node.Body)
	if err != nil {
		return "", err
	}
	values := board.NodeContext(node)
	values.Workflow, err = withTaskAssignments(values.Workflow, assignments)
	if err != nil {
		return "", err
	}
	return r.renderTaskFolder(node.Settings.Folder, values)
}

// A new play can replace a chat whose resolved directory changed.
// A handoff uses the source directory.
func (r *ChainRunner) chatForTaskFolder(node *pkgBoards.FlowNode, values pkgBoards.NodeContext, chat string, handoff bool) (string, error) {
	folder := filesystem.NormaliseVirtual(node.Settings.WorkFolder())
	dynamic := pkgBoards.HasContextReference(node.Settings.Folder)
	if dynamic {
		var err error
		folder, err = r.renderTaskFolder(node.Settings.Folder, values)
		if err != nil {
			return "", err
		}
		node.Settings.Folder = folder
	}
	if chat == "" || (!dynamic && !handoff) {
		return chat, nil
	}
	meta, err := r.convs.Get(chat)
	if err != nil {
		return "", err
	}
	if meta.Folder == folder {
		return chat, nil
	}
	if handoff {
		return "", fmt.Errorf("“%s” runs in another folder than the chat it would follow on from", node.Title)
	}
	return "", nil
}
