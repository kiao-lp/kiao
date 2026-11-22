import React, { useCallback, useState } from 'react';
import { Modal, message } from 'antd';
import type { GitResult, GitStatus } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { useRefreshFileList } from '../files/core/CurrentFileList-ctx';
import { useGitDiff } from './GitDiff-ctx';
import { timestampCommitMessage } from './gitCommitMessage';

const gitOutput = (output: string) => React.createElement('pre', { className: 'git-output' }, output);

// Panel-local result reporting: a successful action only toasts when it produced
// output (push/pull), while failures always open a modal with the git output.
// `detail` is for actions whose report is the point (consolidate): success opens
// a modal too, so the figures stay on screen.
const reportResult = (title: string, r: GitResult, detail: boolean) => {
    if (!r.ok) {
        Modal.error({ title: `${title} failed`, content: gitOutput(r.output) });
    } else if (detail && r.output) {
        Modal.success({ title: `${title} ✓`, content: gitOutput(r.output) });
    } else if (r.output) {
        message.success({ content: `${title} ✓`, duration: 2 });
    }
};

export interface GitActions {
    busy: boolean;
    commitMsg: string;
    setCommitMsg: (msg: string) => void;
    stage: (path: string) => void;
    unstage: (path: string) => void;
    revert: (path: string) => void;
    stageAll: () => void;
    unstageAll: () => void;
    revertAll: () => void;
    commit: (amend: boolean) => void;
    /** Resolves when the (long) consolidation has run and been reported. */
    consolidate: (message: string, pushRemote: boolean) => Promise<void>;
    push: () => void;
    pull: () => void;
    sync: () => void;
    checkout: (branch: string) => void;
    /** Resolves when the creation has run and been reported, so the modal can close after it. */
    createBranch: (name: string) => Promise<void>;
}

/**
 * Owns the Git panel's mutating operations (stage/unstage/discard/commit/
 * consolidate/push/pull/sync/checkout/create-branch) plus the shared `busy` guard and
 * commit-message field. Each action runs serially, reports its result, then
 * refreshes status and the diff.
 *
 * Every one of them is addressed to the repository `folder` belongs to — the same one `status`
 * was read from, which is what makes the paths it carries the right ones to act on.
 */
export const useGitActions = (status: GitStatus | null, refresh: () => Promise<void>, folder: string): GitActions => {
    const workerClient = useWorkerClient();
    const refreshFiles = useRefreshFileList();
    const { requestRefresh } = useGitDiff();

    const [busy, setBusy] = useState(false);
    const [commitMsg, setCommitMsg] = useState(timestampCommitMessage);

    const runAction = useCallback(async (title: string, fn: () => Promise<GitResult>, detail = false) => {
        if (busy) return;
        setBusy(true);
        try {
            const r = await fn();
            reportResult(title, r, detail);
        } catch (e: any) {
            message.error(`${title} failed: ${e?.message ?? e}`);
        } finally {
            setBusy(false);
            await refresh();
            requestRefresh();
        }
    }, [busy, refresh, requestRefresh]);

    // Staging always goes through the batch endpoints — a single row is a list of one — so the
    // service runs one git command per action instead of one per file.
    const stage = useCallback((p: string) => runAction('Stage', () => workerClient.gitStageBatch([p], folder)), [runAction, workerClient, folder]);
    const unstage = useCallback((p: string) => runAction('Unstage', () => workerClient.gitUnstageBatch([p], folder)), [runAction, workerClient, folder]);
    const revert = useCallback((p: string) => runAction('Discard', () => workerClient.gitRevert(p, folder)), [runAction, workerClient, folder]);

    // The tree-wide actions send no paths: the service resolves the file set itself, so one
    // request covers the tree whatever its size.
    const stageAll = useCallback(() => {
        if (!(status?.files ?? []).some(f => f.unstaged)) return;
        runAction('Stage all changes', () => workerClient.gitStageAll(folder));
    }, [status, runAction, workerClient, folder]);

    const unstageAll = useCallback(() => {
        if (!(status?.files ?? []).some(f => f.staged)) return;
        runAction('Unstage all changes', () => workerClient.gitUnstageAll(folder));
    }, [status, runAction, workerClient, folder]);

    const revertAll = useCallback(() => {
        if (!(status?.files ?? []).some(f => f.unstaged)) return;
        runAction('Discard all changes', () => workerClient.gitRevertAll(folder));
    }, [status, runAction, workerClient, folder]);

    const commit = useCallback((amend: boolean) => {
        if (!amend && !commitMsg.trim()) {
            message.warning('Provide a commit message');
            return;
        }
        runAction(amend ? 'Commit (amend)' : 'Commit', async () => {
            const r = await workerClient.gitCommit(commitMsg, amend, folder);
            if (r.ok) setCommitMsg('');
            return r;
        });
    }, [commitMsg, runAction, workerClient, folder]);

    // Repacking a large store takes minutes, and its report — what was squashed, what it freed,
    // what still holds history — is the answer the user asked for, so it goes to a modal.
    const consolidate = useCallback((message: string, pushRemote: boolean) => (
        runAction('Consolidate', () => workerClient.gitConsolidate(message, pushRemote, folder), true)
    ), [runAction, workerClient, folder]);

    const push = useCallback(() => runAction('Push', () => workerClient.gitPush(folder)), [runAction, workerClient, folder]);
    const pull = useCallback(() => runAction('Pull', () => workerClient.gitPull(folder)), [runAction, workerClient, folder]);
    const sync = useCallback(() => runAction('Sync', async () => {
        const pulled = await workerClient.gitPull(folder);
        if (!pulled.ok) return pulled;
        return workerClient.gitPush(folder);
    }), [runAction, workerClient, folder]);

    // Switching branch rewrites the working tree under the whole application, not just under the
    // panel: `requestRefresh` — which every action ends on — is what tells the open diff to reread,
    // and the file listings are read again so the tree and the browser show the branch just moved
    // to rather than the one just left. Open documents follow on their own (see useDocumentFileSync).
    const checkout = useCallback((branch: string) => (
        runAction(`Switch to ${branch}`, () => workerClient.gitCheckout(branch, folder))
            .then(() => { refreshFiles(); })
    ), [runAction, workerClient, folder, refreshFiles]);

    // Starting a branch switches to it too, so it ends the same way a switch does.
    const createBranch = useCallback((name: string) => (
        runAction(`Create branch ${name}`, () => workerClient.gitCreateBranch(name, folder))
            .then(() => { refreshFiles(); })
    ), [runAction, workerClient, folder, refreshFiles]);

    return { busy, commitMsg, setCommitMsg, stage, unstage, revert, stageAll, unstageAll, revertAll, commit, consolidate, push, pull, sync, checkout, createBranch };
};
