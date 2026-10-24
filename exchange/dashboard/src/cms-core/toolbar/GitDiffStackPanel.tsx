import React, { useEffect } from 'react';
import { useCentralStack } from '../core/CentralStack-ctx';
import { lazyComponent } from '../core/lazyComponent';
import { useGitDiffOptional } from './GitDiff-ctx';

export const GIT_DIFF_PANEL_ID = 'git-diff';

const GitDiffBody = lazyComponent(() => import('./GitDiffView').then(m => ({ default: m.GitDiffBody })));

/**
 * The diff's panel on the central area's stack, following the git panel's target: a target opens
 * it over whatever the area is showing, and it closes back onto that. Rendered by `LayoutContent`
 * itself, so it answers in every view — an open document, a board, the boards list.
 *
 * The target outlives the panel: navigating to another document or board brings up a new area, and
 * its follower pushes the panel again — which is why, unlike the flow node editor, this one has no
 * unmount cleanup closing it. What was typed in the working-tree pane outlives it too, in the
 * draft above the layout (GitDiff-ctx). Only the floating cross — through `onClose` — clears the
 * target, and closing is abandoning.
 */
export const GitDiffStackPanel: React.FC = () => {
    const gitDiff = useGitDiffOptional();
    const { push, close } = useCentralStack();

    const diffTarget = gitDiff?.diffTarget ?? null;
    const closeDiff = gitDiff?.closeDiff;

    useEffect(() => {
        if (!diffTarget || !closeDiff) {
            close(GIT_DIFF_PANEL_ID);
            return;
        }
        push({
            id: GIT_DIFF_PANEL_ID,
            // No title: the diff's own header row — path, hunk navigator, actions — is the header.
            label: `Diff of ${diffTarget.path}`,
            closeLabel: 'Close',
            onClose: () => closeDiff(),
            content: <GitDiffBody />,
        });
        // The content reads the target live, so only the target is watched: a keystroke in the
        // working-tree pane must not re-push the panel it is typed in. `push`, `close` and
        // `closeDiff` are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diffTarget]);

    return null;
};
