import React, { useEffect, useRef } from 'react';
import { Modal, message } from 'antd';
import type { GitResult, GitStatus } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { useGitDiff } from './GitDiff-ctx';
import { markInternalNavigation, isRecentInternalNavigation } from '../lib/internal-navigation';
import { internalPathOf } from '../lib/internal-links';
import { timestampCommitMessage } from './gitCommitMessage';

// The monitor always toasts on success (unlike the Git panel, which only toasts
// when an action produced output) — so it keeps its own reportResult.
const reportResult = (title: string, r: GitResult) => {
    if (r.ok) {
        message.success({ content: `${title} ✓`, duration: 2 });
    } else {
        Modal.error({ title: `${title} failed`, content: <pre className="git-output">{r.output}</pre> });
    }
};

const pendingCount = (s: GitStatus | null): { ahead: number; uncommitted: number } => ({
    ahead: s?.ahead ?? 0,
    uncommitted: s?.files?.length ?? 0,
});

/**
 * The prompts that bracket a session: pull what the remote gained on arrival, commit and push what
 * the session produced on the way out.
 *
 * Every call it makes leaves the folder out, which addresses the store's own repository. That is
 * deliberate, and the one place it differs from the Git panel: the panel manages the repository of
 * the folder being browsed, but leaving the app is not about wherever the browser happened to stop
 * — it is about the store not being left with work only this machine has. Scoping these prompts to
 * the current folder would let a session end with the store's own changes unpushed because the last
 * thing opened lived somewhere else.
 */
export const GitSyncMonitor: React.FC = () => {
    const workerClient = useWorkerClient();
    const { refreshToken, requestRefresh } = useGitDiff();
    const statusRef = useRef<GitStatus | null>(null);
    const startupDoneRef = useRef(false);
    const modalOpenRef = useRef(false);
    const statusReqId = useRef(0);

    // On mount: fetch the remote and prompt to pull if behind.
    useEffect(() => {
        if (startupDoneRef.current) return;
        startupDoneRef.current = true;
        (async () => {
            let status: GitStatus;
            try {
                status = await workerClient.gitFetch();
            } catch {
                return;
            }
            statusRef.current = status;
            if (!status?.repo || !status.hasUpstream || (status.behind ?? 0) <= 0) return;
            const modal = Modal.confirm({
                title: 'Pull from remote?',
                content: `Your branch is ${status.behind} commit(s) behind ${status.upstream || 'remote'}.`,
                okText: 'Pull',
                cancelText: 'Skip',
                onOk: () => (async () => {
                    try {
                        const r = await workerClient.gitPull();
                        reportResult('Pull', r);
                    } catch (e: any) {
                        message.error(`Pull failed: ${e?.message ?? e}`);
                    } finally {
                        requestRefresh();
                    }
                })().finally(() => modal.destroy()),
            });
        })();
    }, [workerClient, requestRefresh]);

    // Keep statusRef in sync. Poll periodically so that edits made outside the Git panel
    // (markdown editor, etc.) are reflected in the close-time check. Also re-read on
    // panel-driven refreshes and when the tab regains focus.
    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        const refreshStatus = async () => {
            if (document.visibilityState !== 'visible') return;
            // Skip the tick rather than stack another request on top: `git status` over a large or
            // bind-mounted work tree can take longer than the 15s period, and since nothing here
            // can cancel a request in flight, polling regardless piles up concurrent calls that
            // contend for the very tree that made the first one slow.
            if (inFlight) return;
            inFlight = true;
            const id = ++statusReqId.current;
            try {
                const s = await workerClient.gitStatus();
                if (cancelled || id !== statusReqId.current) return;
                statusRef.current = s;
            } catch {
                // ignore — transient network/auth errors should not break the prompt
            } finally {
                inFlight = false;
            }
        };

        refreshStatus();
        const interval = setInterval(refreshStatus, 15000);
        const onVisibility = () => { if (document.visibilityState === 'visible') refreshStatus(); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [workerClient, refreshToken]);

    // Close-time hooks: warn the browser on unload, and prompt to commit/push on stay-back.
    useEffect(() => {
        const commitAndPush = async () => {
            try {
                let s: GitStatus;
                try {
                    s = await workerClient.gitStatus();
                } catch (e: any) {
                    message.error(`Git status failed: ${e?.message ?? e}`);
                    return;
                }
                const unstaged = (s.files ?? []).filter(f => f.unstaged).map(f => f.path);
                if (unstaged.length) {
                    const r = await workerClient.gitStageBatch(unstaged);
                    if (!r.ok) { reportResult('Stage', r); return; }
                }
                const stillToCommit = unstaged.length > 0 || (s.files ?? []).some(f => f.staged);
                if (stillToCommit) {
                    const c = await workerClient.gitCommit(timestampCommitMessage(), false);
                    if (!c.ok) { reportResult('Commit', c); return; }
                }
                const p = await workerClient.gitPush();
                reportResult('Push', p);
            } catch (e: any) {
                message.error(`Commit & push failed: ${e?.message ?? e}`);
            } finally {
                requestRefresh();
            }
        };

        const pushOnly = async () => {
            try {
                const r = await workerClient.gitPush();
                reportResult('Push', r);
            } catch (e: any) {
                message.error(`Push failed: ${e?.message ?? e}`);
            } finally {
                requestRefresh();
            }
        };

        const showCloseModal = () => {
            if (modalOpenRef.current) return;
            const { ahead, uncommitted } = pendingCount(statusRef.current);
            if (ahead <= 0 && uncommitted <= 0) return;

            const parts: string[] = [];
            if (uncommitted > 0) parts.push(`${uncommitted} uncommitted change(s)`);
            if (ahead > 0) parts.push(`${ahead} unpushed commit(s)`);
            const content = `You have ${parts.join(' and ')}.`;
            const title = uncommitted > 0 ? 'Commit & push?' : 'Push to remote?';
            const okText = uncommitted > 0 ? 'Commit & push' : 'Push';
            const action = uncommitted > 0 ? commitAndPush : pushOnly;

            modalOpenRef.current = true;
            const modal = Modal.confirm({
                title,
                content,
                okText,
                cancelText: 'Skip',
                onOk: () => action().finally(() => modal.destroy()),
                afterClose: () => { modalOpenRef.current = false; },
            });
        };

        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            // Skip when the unload stays inside dashboard: a plain anchor click that lands back
            // in the app, a keyboard reload (F5 / Ctrl+R), or a programmatic internalReload().
            // The user is not really leaving, so the commit/push prompt would be noise.
            if (isRecentInternalNavigation()) return;
            const { ahead, uncommitted } = pendingCount(statusRef.current);
            if (ahead <= 0 && uncommitted <= 0) return;
            e.preventDefault();
            // Required by older Chrome to trigger the native dialog; deprecated but harmless.
            e.returnValue = '';
            // Browsers pause JS while the native dialog is shown. The timer fires only if the
            // user clicks Stay — if they click Leave, the page unloads and pending timers
            // are discarded before this runs.
            setTimeout(showCloseModal, 100);
            return '';
        };

        const onDocumentClick = (e: MouseEvent) => {
            // InternalLinkNavigator turns most of these into router navigations, which never
            // unload the page. What is left — a modified click, an anchor whose click something
            // else handles — still can, so the mark stays.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            const anchor = (e.target as Element | null)?.closest('a');
            if (!anchor) return;
            if (anchor.getAttribute('target') || anchor.hasAttribute('download')) return;
            const href = anchor.getAttribute('href');
            if (href && internalPathOf(href) !== null) {
                markInternalNavigation();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            // F5 (incl. Ctrl/Shift hard-reload) and Ctrl/Cmd+R: the user lands right back
            // in dashboard, so the leave-warning would be noise. Don't preventDefault — the
            // browser must still perform the reload. Capture phase so editors that stop
            // propagation (CodeMirror, etc.) cannot swallow it. The browser toolbar reload
            // button cannot be detected before unload and will still warn.
            if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
                markInternalNavigation();
            }
        };

        window.addEventListener('beforeunload', onBeforeUnload);
        document.addEventListener('click', onDocumentClick, true);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            document.removeEventListener('click', onDocumentClick, true);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [workerClient, requestRefresh]);

    return null;
};
