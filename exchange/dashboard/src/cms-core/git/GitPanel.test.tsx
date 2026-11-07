import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitBranches, GitFile, GitStatus } from 'kiao-worker';

const DEVELOP = 'iso-it/systems/MY Friend/code/develop';

const h = vi.hoisted(() => ({
    focusedPath: '',
    status: null as GitStatus | null,
    branches: null as GitBranches | null,
    gitStatus: vi.fn(async (_folder?: string): Promise<GitStatus> => h.status!),
    gitBranches: vi.fn(async (_folder?: string): Promise<GitBranches> => h.branches!),
    gitCheckout: vi.fn(async (_branch: string, _folder?: string) => ({ ok: true, output: '' })),
    gitCreateBranch: vi.fn(async (_branch: string, _folder?: string) => ({ ok: true, output: '' })),
    refreshFiles: vi.fn(),
    openDiff: vi.fn(),
    requestRefresh: vi.fn(),
}));

vi.mock('../files/nav-bar/NavTreeStore-ctx', () => ({
    useNavTreeStore: () => ({ focusedPath: h.focusedPath }),
}));
vi.mock('../files/service/ui', () => ({
    useWorkerClient: () => ({
        gitStatus: h.gitStatus,
        gitBranches: h.gitBranches,
        gitCheckout: h.gitCheckout,
        gitCreateBranch: h.gitCreateBranch,
    }),
}));
vi.mock('../files/core/CurrentFileList-ctx', () => ({
    useRefreshFileList: () => h.refreshFiles,
}));
vi.mock('./GitDiff-ctx', () => ({
    useGitDiff: () => ({
        diffTarget: null,
        openDiff: h.openDiff,
        closeDiff: vi.fn(),
        refreshToken: 0,
        requestRefresh: h.requestRefresh,
    }),
}));

import { GitPanelContent } from './GitPanel';

const statusIn = (root: string): GitStatus => ({
    repo: true,
    root,
    branch: root ? 'develop' : 'main',
    upstream: '',
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    files: [],
});

const gitFile = (over: Partial<GitFile> & { path: string }): GitFile => ({
    oldPath: null,
    index: ' ',
    worktree: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    ...over,
});

describe('GitPanelContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.focusedPath = '';
        h.status = statusIn('');
    });

    // Opening a branch is browsing rather than navigating, so the browser stays behind
    // while the hand moves on — and the panel follows the hand, not the browser.
    it('acts on the repository the tree focused', async () => {
        h.focusedPath = DEVELOP;
        h.status = statusIn(DEVELOP);

        render(<GitPanelContent />);

        await waitFor(() => expect(h.gitStatus).toHaveBeenCalledWith(DEVELOP));
        // And says so: the scope is only visible when it is not the store's own.
        expect(await screen.findByText(DEVELOP)).toBeTruthy();
    });

    it('acts on the store itself when the hand never left it', async () => {
        const { container } = render(<GitPanelContent />);

        await waitFor(() => expect(h.gitStatus).toHaveBeenCalledWith(''));
        expect(container.querySelector('.git-repo-scope')).toBeNull();
    });

    it('offers discard-all and stage-all over unstaged changes', async () => {
        h.status = { ...statusIn(''), files: [gitFile({ path: 'docs/edited.md' })] };

        const { container } = render(<GitPanelContent />);

        await waitFor(() => expect(container.querySelector('[aria-label="Stage all changes"]')).toBeTruthy());
        expect(container.querySelector('[aria-label="Discard all changes"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Unstage all changes"]')).toBeNull();
    });

    it('offers unstage-all over staged changes', async () => {
        h.status = {
            ...statusIn(''),
            files: [gitFile({ path: 'docs/staged.md', index: 'M', worktree: ' ', staged: true, unstaged: false })],
        };

        const { container } = render(<GitPanelContent />);

        await waitFor(() => expect(container.querySelector('[aria-label="Unstage all changes"]')).toBeTruthy());
        expect(container.querySelector('[aria-label="Discard all changes"]')).toBeNull();
    });

    it('strikes through a deleted file', async () => {
        h.status = { ...statusIn(''), files: [gitFile({ path: 'docs/gone.md', worktree: 'D' })] };

        const { container } = render(<GitPanelContent />);

        await waitFor(() => expect(container.querySelector('.git-file-row.git-file-deleted')).toBeTruthy());
    });

    it('opens the diff with the repository root, so the file can be opened back', async () => {
        h.focusedPath = DEVELOP;
        h.status = { ...statusIn(DEVELOP), files: [gitFile({ path: 'docs/edited.md' })] };

        const { container } = render(<GitPanelContent />);

        await waitFor(() => expect(container.querySelector('.git-file-row')).toBeTruthy());
        fireEvent.click(container.querySelector('.git-file-row') as HTMLElement);

        await waitFor(() => expect(h.openDiff).toHaveBeenCalledWith('docs/edited.md', DEVELOP, DEVELOP));
    });

    // The branch is read off the panel rather than the dropdown: the selector shows it closed.
    // (The aria-label sits on both the box and its search input, hence the plural query.)
    it('shows the current branch and switches to the one picked', async () => {
        h.branches = {
            current: 'main',
            branches: [
                { name: 'main', remote: false, current: true },
                { name: 'feature', remote: false, current: false },
            ],
        };

        render(<GitPanelContent />);

        await waitFor(() => expect(screen.getAllByLabelText('Current branch').length).toBeGreaterThan(0));
        expect(document.querySelector('.git-branch-select')!.textContent).toContain('main');

        const select = document.querySelector('.git-branch-select')!;
        fireEvent.mouseDown(select.querySelector('.ant-select-selector') ?? select);
        await waitFor(() => expect(h.gitBranches).toHaveBeenCalledWith(''));
        fireEvent.click(await screen.findByText('feature'));
        await waitFor(() => expect(h.gitCheckout).toHaveBeenCalledWith('feature', ''));
        // And the rest of the application follows the switch: the file listings are read again,
        // so the tree and the browser show the branch just moved to.
        await waitFor(() => expect(h.refreshFiles).toHaveBeenCalled());
    });

    it('creates the branch the modal names, and nothing on an empty name', async () => {
        render(<GitPanelContent />);

        fireEvent.click(await screen.findByRole('button', { name: 'Create new branch' }));
        const input = await screen.findByLabelText('New branch name');
        const create = (await screen.findByText('Create branch', { selector: '.ant-modal-title' }))
            .closest('.ant-modal')!.querySelector('.ant-btn-primary') as HTMLButtonElement;
        expect(create.disabled).toBe(true);

        fireEvent.change(input, { target: { value: 'feature/y' } });
        expect(create.disabled).toBe(false);
        fireEvent.click(create);

        await waitFor(() => expect(h.gitCreateBranch).toHaveBeenCalledWith('feature/y', ''));
        await waitFor(() => expect(h.refreshFiles).toHaveBeenCalled());
    });
});
