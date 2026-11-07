import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GitFile } from 'kiao-worker';
import { GitFileRow } from './GitFileRow';

const file = (over: Partial<GitFile>): GitFile => ({
    path: 'docs/gone.md',
    oldPath: null,
    index: ' ',
    worktree: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    ...over,
});

const renderRow = (f: GitFile, staged: boolean) => render(
    <GitFileRow file={f} staged={staged} onOpen={vi.fn()} onStage={vi.fn()} onUnstage={vi.fn()} onRevert={vi.fn()} />,
);

describe('GitFileRow', () => {
    it('strikes through a file deleted in the working tree', () => {
        const { container } = renderRow(file({ worktree: 'D' }), false);
        expect(container.querySelector('.git-file-row.git-file-deleted')).toBeTruthy();
    });

    it('strikes through a file deleted in the index when shown staged', () => {
        const { container } = renderRow(file({ path: 'gone.md', index: 'D', worktree: ' ', staged: true, unstaged: false }), true);
        expect(container.querySelector('.git-file-row.git-file-deleted')).toBeTruthy();
    });

    it('does not strike through a modified file', () => {
        const { container } = renderRow(file({ worktree: 'M' }), false);
        expect(container.querySelector('.git-file-row.git-file-deleted')).toBeNull();
    });

    it('reads the staged side when shown staged', () => {
        // Deleted in the work tree but only modified in the index: the staged row shows M, unstruck.
        const { container } = renderRow(file({ index: 'M', worktree: 'D', staged: true, unstaged: true }), true);
        const row = container.querySelector('.git-file-row')!;
        expect(row.classList.contains('git-file-deleted')).toBe(false);
        expect(row.querySelector('.git-file-badge')!.textContent).toBe('M');
    });
});
