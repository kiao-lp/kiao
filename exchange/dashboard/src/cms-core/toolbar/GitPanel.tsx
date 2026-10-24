import React, { useState } from 'react';
import { Button, Dropdown, Input, Popconfirm, Select, Spin, Space } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import {
    BranchesOutlined,
    PlusOutlined,
    MinusOutlined,
    MoreOutlined,
    ReloadOutlined,
    CloudUploadOutlined,
    DownloadOutlined,
    DownOutlined,
    RightOutlined,
    SyncOutlined,
    CompressOutlined,
    FolderOutlined,
    CloudOutlined,
    RollbackOutlined,
} from '@ant-design/icons';
import { useGitDiff } from './GitDiff-ctx';
import { useNavTreeStore } from '../files/nav-bar/NavTreeStore-ctx';
import { useGitStatus } from './useGitStatus';
import { useGitActions } from './useGitActions';
import { useGitBranches } from './useGitBranches';
import { GitFileRow } from './GitFileRow';
import { GitConsolidateModal } from './GitConsolidateModal';
import { GitCreateBranchModal } from './GitCreateBranchModal';
import './GitPanel.css';

/**
 * Source control for the repository the hand is on — the browsed folder's, unless a branch of
 * the navigation tree was opened or closed without navigating, in which case that folder's.
 * Opening a branch is browsing rather than navigating, so the tree keeps that touch as its
 * focus (see NavTreeStore-ctx) and this panel acts on it. Following the folder rather than
 * the store keeps every path the panel shows relative to the repository it acts on, and keeps
 * a commit made here from reaching across a repository boundary the user cannot see. The
 * close-time commit prompt is deliberately not scoped this way: leaving the app is about the
 * store, not about wherever the browser happened to stop (see GitSyncMonitor).
 */
export const GitPanelContent: React.FC = () => {
    const { openDiff } = useGitDiff();
    const { focusedPath } = useNavTreeStore();
    const { status, loading, error, refresh } = useGitStatus(focusedPath);
    const {
        busy, commitMsg, setCommitMsg,
        stage, unstage, revert, stageAll, unstageAll, revertAll, commit, consolidate, push, pull, sync, checkout, createBranch,
    } = useGitActions(status, refresh, focusedPath);
    const branches = useGitBranches(focusedPath);
    const [consolidateOpen, setConsolidateOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [stagedOpen, setStagedOpen] = useState(true);
    const [changesOpen, setChangesOpen] = useState(true);

    if (loading && !status) {
        return <div className="git-panel-center"><Spin /></div>;
    }
    if (error) {
        return (
            <div className="git-panel-center">
                <p>{error}</p>
                <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>Retry</Button>
            </div>
        );
    }
    if (status && !status.repo) {
        return <div className="git-panel-center">This folder is not in a git repository.</div>;
    }

    const files = status?.files ?? [];
    const stagedFiles = files.filter(f => f.staged);
    const changedFiles = files.filter(f => f.unstaged);

    // Polymorph push/pull/sync button.
    let syncBtn: { label: string; sub?: string; icon: React.ReactNode; action: () => void } | null = null;
    if (status?.hasUpstream) {
        if (status.ahead > 0 && status.behind > 0) {
            syncBtn = { label: 'Sync', sub: `↓${status.behind} ↑${status.ahead}`, icon: <SyncOutlined />, action: sync };
        } else if (status.ahead > 0) {
            syncBtn = { label: 'Push', sub: `↑${status.ahead}`, icon: <CloudUploadOutlined />, action: push };
        } else if (status.behind > 0) {
            syncBtn = { label: 'Pull', sub: `↓${status.behind}`, icon: <DownloadOutlined />, action: pull };
        }
    } else if (status?.branch) {
        syncBtn = { label: 'Publish', icon: <CloudUploadOutlined />, action: push };
    }

    // The branch on HEAD always heads the list, even before the list has been read: it is what the
    // selector must show while closed, and a Select with no matching option would show nothing.
    const current = status?.branch ?? '';
    const branchOptions = [
        ...(current && !branches.branches.some(b => b.name === current) ? [{ value: current, label: current }] : []),
        ...branches.branches.map(b => ({
            value: b.name,
            label: b.remote ? <span className="git-branch-remote"><CloudOutlined /> {b.name}</span> : b.name,
        })),
    ];

    return (
        <div className="git-panel">
            <div className="git-panel-head">
                <BranchesOutlined className="git-branch-icon" />
                <Tooltip title={status?.upstream || undefined}>
                    <Select
                        className="git-branch-select"
                        size="small"
                        variant="borderless"
                        showSearch
                        disabled={busy || !current}
                        value={current || undefined}
                        placeholder="detached"
                    loading={branches.loading}
                    options={branchOptions}
                    popupMatchSelectWidth={false}
                    optionFilterProp="value"
                    aria-label="Current branch"
                    onOpenChange={open => { if (open) branches.load(); }}
                    onChange={value => { if (value !== current) checkout(value); }}
                    />
                </Tooltip>
                <Tooltip title="Create new branch">
                    <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setCreateOpen(true)}
                        aria-label="Create new branch"
                        disabled={busy}
                    />
                </Tooltip>
                <Tooltip title="Refresh">
                    <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined spin={busy} />}
                        onClick={refresh}
                        aria-label="Refresh"
                    />
                </Tooltip>
            </div>

            {/* Which repository answered — shown only when it is not the store's own, since that
                is the one case where the panel's contents would otherwise be unexplained. */}
            {status?.root && (
                <Tooltip title={`Git commands run in ${status.root}, the repository this folder belongs to`}>
                    <div className="git-repo-scope"><FolderOutlined /> {status.root}</div>
                </Tooltip>
            )}

            <Input.TextArea
                className="git-commit-msg"
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                placeholder={`Message (commit on ${current || 'HEAD'})`}
                autoSize={{ minRows: 2, maxRows: 6 }}
            />

            {/* Committing and publishing share one row: two full-width buttons stacked cost the
                file lists a whole line of height for two clicks that are each one word wide. */}
            <div className="git-action-row">
                <Space.Compact className="git-commit-btn">
                    <Button
                        size="small"
                        type="primary"
                        block
                        disabled={busy || stagedFiles.length === 0}
                        onClick={() => commit(false)}
                    >
                        Commit
                    </Button>
                    <Dropdown
                        trigger={['click']}
                        disabled={busy || stagedFiles.length === 0}
                        menu={{
                            items: [
                                { key: 'commit', label: 'Commit' },
                                { key: 'amend', label: 'Commit (Amend)' },
                            ],
                            onClick: ({ key }) => commit(key === 'amend'),
                        }}
                    >
                        <Button size="small" type="primary" icon={<DownOutlined />} />
                    </Dropdown>
                </Space.Compact>

                {syncBtn && (
                    <Button
                        className="git-sync-btn"
                        size="small"
                        icon={syncBtn.icon}
                        loading={busy}
                        onClick={syncBtn.action}
                    >
                        {syncBtn.label}{syncBtn.sub ? <span className="git-sync-sub"> {syncBtn.sub}</span> : null}
                    </Button>
                )}
            </div>

            <div className="git-section">
                <div className="git-section-head">
                    <button
                        type="button"
                        className="git-section-toggle"
                        aria-expanded={stagedOpen}
                        onClick={() => setStagedOpen(open => !open)}
                    >
                        <span className="git-section-chevron" aria-hidden="true">
                            {stagedOpen ? <DownOutlined /> : <RightOutlined />}
                        </span>
                        Staged Changes
                    </button>
                    <span className="git-section-head-right">
                        {stagedFiles.length > 0 && (
                            <Tooltip title="Unstage all changes">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<MinusOutlined />}
                                    aria-label="Unstage all changes"
                                    disabled={busy}
                                    onClick={unstageAll}
                                />
                            </Tooltip>
                        )}
                        <span className="git-count">{stagedFiles.length}</span>
                    </span>
                </div>
                {stagedOpen && stagedFiles.map(f => (
                    <GitFileRow
                        key={`s:${f.path}`}
                        file={f}
                        staged
                        onOpen={path => openDiff(path, focusedPath, status?.root ?? '')}
                        onStage={stage}
                        onUnstage={unstage}
                        onRevert={revert}
                    />
                ))}
            </div>

            <div className="git-section">
                <div className="git-section-head">
                    <button
                        type="button"
                        className="git-section-toggle"
                        aria-expanded={changesOpen}
                        onClick={() => setChangesOpen(open => !open)}
                    >
                        <span className="git-section-chevron" aria-hidden="true">
                            {changesOpen ? <DownOutlined /> : <RightOutlined />}
                        </span>
                        Changes
                    </button>
                    <span className="git-section-head-right">
                        {changedFiles.length > 0 && (
                            <>
                                <Popconfirm
                                    title="Discard all changes?"
                                    description="This cannot be undone."
                                    okText="Discard"
                                    okButtonProps={{ danger: true }}
                                    onConfirm={revertAll}
                                >
                                    <Tooltip title="Discard all changes">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<RollbackOutlined />}
                                            aria-label="Discard all changes"
                                            disabled={busy}
                                        />
                                    </Tooltip>
                                </Popconfirm>
                                <Tooltip title="Stage all changes">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<PlusOutlined />}
                                        aria-label="Stage all changes"
                                        disabled={busy}
                                        onClick={stageAll}
                                    />
                                </Tooltip>
                            </>
                        )}
                        <span className="git-count">{changedFiles.length}</span>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: [
                                    { key: 'pull', label: 'Pull', icon: <DownloadOutlined /> },
                                    { type: 'divider' },
                                    {
                                        key: 'consolidate',
                                        label: 'Consolidate repository…',
                                        icon: <CompressOutlined />,
                                        danger: true,
                                        disabled: busy,
                                        title: 'Squash the whole history into one commit and free the space it holds',
                                    },
                                ],
                                onClick: ({ key }) => {
                                    if (key === 'pull') pull();
                                    if (key === 'consolidate') setConsolidateOpen(true);
                                },
                            }}
                        >
                            <Tooltip title="More actions">
                                <Button type="text" size="small" icon={<MoreOutlined />} aria-label="More actions" />
                            </Tooltip>
                        </Dropdown>
                    </span>
                </div>
                {changesOpen && changedFiles.map(f => (
                    <GitFileRow
                        key={`c:${f.path}`}
                        file={f}
                        staged={false}
                        onOpen={path => openDiff(path, focusedPath, status?.root ?? '')}
                        onStage={stage}
                        onUnstage={unstage}
                        onRevert={revert}
                    />
                ))}
                {changesOpen && stagedFiles.length === 0 && changedFiles.length === 0 && (
                    <div className="git-empty">No changes</div>
                )}
            </div>

            <GitConsolidateModal
                open={consolidateOpen}
                branch={current || 'HEAD'}
                upstream={status?.hasUpstream ? status.upstream : undefined}
                busy={busy}
                onConfirm={async (message, pushRemote) => {
                    await consolidate(message, pushRemote);
                    setConsolidateOpen(false);
                }}
                onCancel={() => setConsolidateOpen(false)}
            />

            <GitCreateBranchModal
                open={createOpen}
                busy={busy}
                onConfirm={async (name) => {
                    await createBranch(name);
                    setCreateOpen(false);
                }}
                onCancel={() => setCreateOpen(false)}
            />
        </div>
    );
};
