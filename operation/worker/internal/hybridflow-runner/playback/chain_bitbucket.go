package playback

import (
	"context"
	"fmt"
	"strings"

	"kiao/worker/internal/hybridflow-runner/bitbucket"
	pkgBoards "kiao/worker/internal/hybridflow-runner/boards"
	runstate "kiao/worker/internal/hybridflow-runner/playback/state"
)

func (r *ChainRunner) playBitbucketStatus(
	ctx context.Context, run *ChainRun, flowNode pkgBoards.FlowNode, values pkgBoards.NodeContext, out PlayOneOutcome,
) PlayOneOutcome {
	out.Round = roundStop
	if !pkgBoards.IsBitbucketEvent(flowNode.Type) {
		return out
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	wake := run.waking()
	go func() {
		select {
		case <-wake:
			cancel()
		case <-ctx.Done():
		}
	}()

	err := r.waitForBitbucketStatus(ctx, run, flowNode, values, out.Chat)
	if ctx.Err() != nil || r.stopping(run) {
		return out
	}
	if err != nil {
		r.say(run, runstate.NoticeError, "Could not check Bitbucket status: "+err.Error())
		r.fail(run, flowNode.ID)
		return out
	}
	return r.completeAutomatic(run, flowNode.ID, values.Input, out)
}

func (r *ChainRunner) waitForBitbucketStatus(ctx context.Context, run *ChainRun, node pkgBoards.FlowNode, values pkgBoards.NodeContext, chat string) error {
	kind, id, target := "pull request", node.PullRequestID, node.PullRequestStatus
	newCheck := bitbucket.NewPullRequest
	validStatus := bitbucket.ValidPullRequestStatus
	if node.Type == pkgBoards.FlowNodeTypeBitbucketCommitStatus {
		kind, id, target = "commit", node.CommitID, node.CommitStatus
		newCheck = bitbucket.NewCommit
		validStatus = bitbucket.ValidCommitStatus
	}
	id, err := values.RenderField(kind+" ID", id)
	if err != nil {
		return err
	}
	target, err = values.RenderField("target status", target)
	if err != nil {
		return err
	}
	target = strings.ToUpper(target)
	if !validStatus(target) {
		return fmt.Errorf("%q is not a valid %s target status", target, kind)
	}
	credentials, err := r.cfg.ReadAtlassian()
	if err != nil {
		return err
	}
	check, err := newCheck(credentials.Bitbucket, id)
	if err != nil {
		return err
	}
	r.LogNote(run, node.ID, chat, runstate.NoticeInfo,
		fmt.Sprintf("Waiting for Bitbucket %s %s to reach %s", kind, id, target))
	err = check.Wait(ctx, r.BitbucketClient, target, r.BitbucketInterval, func(err error) {
		r.LogNote(run, node.ID, chat, runstate.NoticeWarning, err.Error()+". Retrying.")
	})
	if err != nil {
		return fmt.Errorf("%s %q: %w", kind, id, err)
	}
	return nil
}
