import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Modal } from 'antd';
import type { DuplicateGroup } from 'kiao-worker';

// Location and name are chosen separately; both are required. One button runs all groups.

vi.mock('@kiao-dashboard-core', async () => ({
    Tooltip: (await import('../../core/ui-foundation/feedback/Tooltip')).Tooltip,
    useNavigation: () => ({ open: vi.fn(), openInNewTab: vi.fn(), openInNewWindow: vi.fn(), goUp: vi.fn(), goTo: vi.fn() }),
}));

import { DuplicatesTab } from './DuplicatesTab';

const GROUP: DuplicateGroup = {
    hash: 'abc123',
    size: 2048,
    wasted: 2048,
    files: [
        { path: 'assets/IMG_4471.png', isDirectory: false, size: 2048, lastModified: 1_700_000_000_000 },
        { path: 'scratch/logo.png', isDirectory: false, size: 2048, lastModified: 1_700_000_000_000 },
    ],
};

const OTHER: DuplicateGroup = {
    hash: 'def456',
    size: 1024,
    wasted: 1024,
    files: [
        { path: 'notes/draft.md', isDirectory: false, size: 1024, lastModified: 1_700_000_000_000 },
        { path: 'archive/memo.md', isDirectory: false, size: 1024, lastModified: 1_700_000_000_000 },
    ],
};

const keepOnlyOne = vi.fn(async (plan: { target: string }[]) =>
    plan.map(c => ({ target: c.target, removed: ['one/gone.png'] })));

const renderTab = (duplicates: DuplicateGroup[] = [GROUP]) =>
    render(<DuplicatesTab duplicates={duplicates} scanned={42} truncated={false} keepOnlyOne={keepOnlyOne} />);

/** Tab button only; confirmation is in a portal. */
const keepButton = () =>
    within(screen.getByTestId('duplicates-tab')).getByRole('button', { name: /keep only one/i });

/** Confirmation dialog, in antd portal. */
const confirmation = () => screen.findByRole('dialog');

/** Radios of one group. */
const groupOf = (name: string) =>
    within(screen.getAllByTestId('duplicate-group').find(g => within(g).queryByText(name))!);

describe('DuplicatesTab', () => {
    // Braced form avoids registering the mock as vitest cleanup.
    beforeEach(() => { keepOnlyOne.mockClear(); });
    // antd portals survive test cleanup in jsdom; clear the body manually.
    afterEach(() => {
        Modal.destroyAll();
        document.body.innerHTML = '';
    });

    it('will not consolidate until both a location and a name have been chosen', async () => {
        renderTab();
        expect(keepButton()).toBeDisabled();

        await userEvent.click(screen.getByLabelText('Keep the location assets'));
        expect(keepButton()).toBeDisabled();

        await userEvent.click(screen.getByLabelText('Keep the name logo.png'));
        expect(keepButton()).toBeEnabled();
    });

    it('shows the path it would keep, built from the two halves of the choice', async () => {
        renderTab();

        await userEvent.click(screen.getByLabelText('Keep the location assets'));
        await userEvent.click(screen.getByLabelText('Keep the name logo.png'));

        expect(screen.getByTestId('keep-target')).toHaveTextContent('/assets/logo.png');
    });

    it('consolidates every copy onto the chosen path, once the confirmation is answered', async () => {
        renderTab();

        await userEvent.click(screen.getByLabelText('Keep the location assets'));
        await userEvent.click(screen.getByLabelText('Keep the name logo.png'));
        await userEvent.click(keepButton());

        const dialog = await confirmation();
        expect(within(dialog).getByText('/scratch/logo.png')).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /keep only one/i }));

        expect(keepOnlyOne).toHaveBeenCalledWith([{
            hash: 'abc123',
            paths: ['assets/IMG_4471.png', 'scratch/logo.png'],
            target: 'assets/logo.png',
            wasted: 2048,
        }]);
    });

    it('runs every group that was answered in one press, and says how many that is', async () => {
        renderTab([GROUP, OTHER]);

        await userEvent.click(groupOf('IMG_4471.png').getByLabelText('Keep the location assets'));
        await userEvent.click(groupOf('IMG_4471.png').getByLabelText('Keep the name logo.png'));
        await userEvent.click(groupOf('draft.md').getByLabelText('Keep the location notes'));
        await userEvent.click(groupOf('draft.md').getByLabelText('Keep the name memo.md'));

        expect(screen.getByTestId('plan-summary')).toHaveTextContent('2 of 2 groups chosen — 3.0 KB');
        expect(keepButton()).toHaveTextContent('Keep only one in 2 groups');

        await userEvent.click(keepButton());
        const dialog = await confirmation();
        expect(within(dialog).getByText('/assets/logo.png')).toBeInTheDocument();
        expect(within(dialog).getByText('/notes/memo.md')).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /keep only one/i }));

        expect(keepOnlyOne).toHaveBeenCalledTimes(1);
        expect(keepOnlyOne.mock.calls[0][0].map((c: any) => c.target))
            .toEqual(['assets/logo.png', 'notes/memo.md']);
    });

    it('leaves a group whose choice is unfinished out of the press entirely', async () => {
        renderTab([GROUP, OTHER]);

        await userEvent.click(groupOf('IMG_4471.png').getByLabelText('Keep the location assets'));
        await userEvent.click(groupOf('IMG_4471.png').getByLabelText('Keep the name logo.png'));
        await userEvent.click(groupOf('draft.md').getByLabelText('Keep the location notes'));

        expect(screen.getByTestId('plan-summary')).toHaveTextContent('1 of 2 groups chosen');

        await userEvent.click(keepButton());
        const dialog = await confirmation();
        expect(within(dialog).queryByText(/draft\.md|memo\.md/)).not.toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /keep only one/i }));

        expect(keepOnlyOne.mock.calls[0][0].map((c: any) => c.target)).toEqual(['assets/logo.png']);
    });

    it('checks the one location on offer when every copy is in the same folder', async () => {
        renderTab([{
            ...GROUP,
            files: [
                { ...GROUP.files[0], path: 'assets/IMG_4471.png' },
                { ...GROUP.files[1], path: 'assets/logo.png' },
            ],
        }]);

        for (const radio of screen.getAllByLabelText('Keep the location assets')) expect(radio).toBeChecked();
        expect(screen.getByLabelText('Keep the name logo.png')).not.toBeChecked();
        expect(screen.getByTestId('keep-unchosen')).toHaveTextContent('Choose a name');
        expect(keepButton()).toBeDisabled();

        await userEvent.click(screen.getByLabelText('Keep the name logo.png'));
        expect(screen.getByTestId('keep-target')).toHaveTextContent('/assets/logo.png');
        expect(keepButton()).toBeEnabled();
    });

    it('checks the one name on offer when every copy bears it', () => {
        renderTab([{
            ...GROUP,
            files: [
                { ...GROUP.files[0], path: 'assets/logo.png' },
                { ...GROUP.files[1], path: 'scratch/logo.png' },
            ],
        }]);

        for (const radio of screen.getAllByLabelText('Keep the name logo.png')) expect(radio).toBeChecked();
        expect(screen.getByLabelText('Keep the location assets')).not.toBeChecked();
        expect(screen.getByLabelText('Keep the location scratch')).not.toBeChecked();
        expect(screen.getByTestId('keep-unchosen')).toHaveTextContent('Choose a location');
        expect(keepButton()).toBeDisabled();
    });

    it('says so plainly when the store holds nothing twice', () => {
        const { container } = renderTab([]);
        expect(screen.getByText(/no file is stored twice/i)).toBeInTheDocument();
        expect(within(container).queryByRole('button', { name: /keep only one/i })).not.toBeInTheDocument();
    });
});
