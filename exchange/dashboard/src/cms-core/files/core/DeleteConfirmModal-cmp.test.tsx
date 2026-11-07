import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { DeleteConfirmModal } from './DeleteConfirmModal-cmp';
import { DeleteScope } from './deleteScope';
import { FileDto } from 'src/cms-core/files/service';

vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>();
    return {
        ...actual,
        Modal: ({ open, children }: any) => (open ? <div data-testid="delete-modal">{children}</div> : null),
    };
});

const entry = (path: string, isDirectory = false): FileDto => ({ path, isDirectory, size: 0, lastModified: 0 });

const show = (scope: DeleteScope) =>
    render(<DeleteConfirmModal scope={scope} onConfirm={vi.fn()} onCancel={vi.fn()} />);

const message = () => screen.getByTestId('delete-confirm-message').textContent ?? '';

describe('DeleteConfirmModal', () => {
    it('names a single file and lists nothing', () => {
        show({ selection: ['docs/a.md'], entries: [entry('docs/a.md')], truncated: false });

        expect(message()).toContain('Delete "a.md"?');
        expect(screen.queryByRole('list')).toBeNull();
    });

    // The count that matters is what comes along, not the total: it is the part the user did not
    // pick and cannot see from the selection.
    it('counts what a folder drags along', () => {
        show({
            selection: ['docs'],
            entries: [entry('docs', true), entry('docs/a.md'), entry('docs/sub', true), entry('docs/sub/b.md')],
            truncated: false,
        });

        expect(message()).toContain('Delete "docs" and the 3 entries inside?');
        expect(screen.getAllByRole('listitem')).toHaveLength(4);
    });

    // The whole point of the cap: a folder holding a node_modules is described, not enumerated,
    // and the dialog must not claim a number it was never given.
    it('says the scope is bigger than what it was told when the server truncated', () => {
        const entries = Array.from({ length: 500 }, (_, i) => entry(`big/f${i}.md`));

        show({ selection: ['big'], entries, truncated: true });

        expect(message()).toContain('more than 499 entries inside');
        expect(screen.getByTestId('delete-confirm-more').textContent).toContain('and more than');
        expect(screen.getAllByRole('listitem').length).toBeLessThan(entries.length);
    });

    // Describing the scope is a courtesy; the selection is what will be deleted either way.
    it('still names the selection when the scope could not be described', () => {
        show({ selection: ['a.md', 'b.md'], entries: [], truncated: false });

        expect(message()).toContain('Delete 2 items?');
    });
});
