import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Modal } from 'antd';
import type { DuplicateGroup } from 'kiao-worker';

/**
 * The duplicates tab's one promise: a copy is kept **somewhere** and **under some name**, the two
 * chosen separately, and nothing happens until both were chosen on purpose.
 *
 * The interesting case is the one the whole model exists for — the good name is on the copy in the
 * wrong folder — so that is the one asserted end to end: the location from one row, the name from
 * another, and the request that goes out naming the two put together.
 *
 * The second thing asserted here is the shape of the *acting*: one button over every group, so a
 * store holding a dozen duplicates is answered a dozen times and confirmed once. A group left
 * half-chosen must survive that press untouched, which is the guard that lets the button be reached
 * before every group on screen has been answered.
 */

vi.mock('../files/navigation/NavigationModel', () => ({
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

/** The tab's own button. The confirmation has one of the same name, in a portal outside the tab. */
const keepButton = () =>
    within(screen.getByTestId('duplicates-tab')).getByRole('button', { name: /keep only one/i });

/** The confirmation antd has opened, in its portal outside the tab. */
const confirmation = () => screen.findByRole('dialog');

/** The radios of one group, so a two-group board can be answered a row at a time. */
const groupOf = (name: string) =>
    within(screen.getAllByTestId('duplicate-group').find(g => within(g).queryByText(name))!);

describe('DuplicatesTab', () => {
    // Braced, and not `() => keepOnlyOne.mockClear()`: a hook that returns a function has returned
    // vitest its cleanup, and the mock would be called — with no plan — after every test.
    beforeEach(() => { keepOnlyOne.mockClear(); });
    // Modal.confirm portals into document.body, which React Testing Library's cleanup does not
    // reach, and jsdom plays no transition for antd to finish closing on — so a confirmation is
    // still standing in the next test, where it is a second dialog and a second "Keep only one".
    // Emptying the body detaches those portals whole, leaving React free to unmount them after.
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

        // The confirmation says what stops naming a file before it is answered.
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

        // What the press reaches, before it is pressed: how many of the groups on screen, and what
        // they are worth together.
        expect(screen.getByTestId('plan-summary')).toHaveTextContent('2 of 2 groups chosen — 3.0 KB');
        expect(keepButton()).toHaveTextContent('Keep only one in 2 groups');

        await userEvent.click(keepButton());
        const dialog = await confirmation();
        // One confirmation, naming both survivors.
        expect(within(dialog).getByText('/assets/logo.png')).toBeInTheDocument();
        expect(within(dialog).getByText('/notes/memo.md')).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /keep only one/i }));

        expect(keepOnlyOne).toHaveBeenCalledTimes(1);
        expect(keepOnlyOne.mock.calls[0][0].map((c: any) => c.target))
            .toEqual(['assets/logo.png', 'notes/memo.md']);
    });

    // The guard that lets one button stand over groups answered and groups not: a half-chosen group
    // is left alone rather than guessed at.
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

    // What has no alternative is answered already — and only that: the half with a choice in it
    // still waits for a click, so the button is no nearer for the preset.
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
