import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Modal, message } from 'antd';

/**
 * The boards page is a list you cross on the way to a board — and the one place a board itself is
 * managed: made, renamed and deleted. These run against the service held in memory, through the
 * real gestures: what is asserted is the row a press reaches, the call it sends, and the list left
 * behind it.
 *
 * The list renders inside the Board panel and carries its own controls.
 */
vi.mock('@cms-core', async () => ({
    useAuthToken: () => 'tok',
    Tooltip: (await import('antd')).Tooltip,
}));

import { BoardsPage } from './BoardsPage';
import { BoardSummary, FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { readBoardContent } from '../boardContent';

/** One board, as a listing answers with it. */
const board = (over: Partial<BoardSummary> & { slug: string }): BoardSummary => ({
    id: `id-${over.slug}`,
    name: over.slug,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    revision: 1,
    archived: false,
    ...over,
});

let service: FakeHybridflowClient;

beforeEach(() => {
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
    service.boardsList = [
        board({ slug: 'major', name: 'Major', updatedAt: '2026-09-10T10:00:00.000Z' }),
        board({ slug: 'minor', name: 'Minor', updatedAt: '2026-09-01T10:00:00.000Z' }),
    ];
});

// Modal.confirm and message both portal into document.body, which React Testing Library's cleanup
// does not reach — so a dialog is still standing in the next test, where it is a second dialog
// and a second Delete. Both are destroyed rather than wiped: emptying the body out from under
// their closing animations is a NotFoundError thrown asynchronously, after the test has passed.
afterEach(() => {
    Modal.destroyAll();
    message.destroy();
});

/** Where the router stands, so a press that navigated is a press that shows. */
const LocationProbe: React.FC = () => {
    const { pathname } = useLocation();
    return <span data-testid="location">{pathname}</span>;
};

const renderPage = (basename = '/') => render(
    <MemoryRouter basename={basename} initialEntries={[`${basename.replace(/\/+$/, '')}/boards`]}>
        <HybridflowClientProvider client={service.asClient()}>
            <LocationProbe />
            <BoardsPage />
        </HybridflowClientProvider>
    </MemoryRouter>,
);

const rows = () => screen.findAllByTestId(/board-row-/);

describe('BoardsPage', () => {
    it('keeps the list controls with the list inside the Board panel', async () => {
        renderPage();
        await rows();

        const page = screen.getByTestId('boards-page');
        expect(within(page).getByRole('button', { name: 'Reload the boards' })).toBeInTheDocument();
        expect(within(page).getByRole('button', { name: /New board/ })).toBeInTheDocument();
        expect(within(page).getByText('Boards')).toBeInTheDocument();
    });

    it('lists every board, most recently touched first, each opening its own address', async () => {
        renderPage();

        const held = await rows();
        expect(held).toHaveLength(2);
        // Major was touched last, so it is crossed first.
        expect(within(held[0]).getByRole('link')).toHaveAttribute('href', '/boards/major');
        expect(within(held[0]).getByText('Major')).toBeInTheDocument();
        expect(within(held[0]).getByText('/major')).toBeInTheDocument();
        expect(within(held[1]).getByRole('link')).toHaveAttribute('href', '/boards/minor');
    });

    it('renames a board from its row, and the board keeps its address', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('rename-board-major'));
        const dialog = await screen.findByRole('dialog');
        // The dialog opens on the name the board has, and says the address stays.
        expect(within(dialog).getByLabelText('Board name')).toHaveValue('Major');
        expect(within(dialog).getByText(/stays at \/boards\/major/)).toBeInTheDocument();

        await userEvent.clear(within(dialog).getByLabelText('Board name'));
        await userEvent.type(within(dialog).getByLabelText('Board name'), 'Majeur');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

        // The row reads the new name at the old address, and the gesture sent the one call.
        const row = await screen.findByTestId('board-row-major');
        expect(within(row).getByText('Majeur')).toBeInTheDocument();
        expect(within(row).getByRole('link')).toHaveAttribute('href', '/boards/major');
        expect(service.calls).toContain('renameBoard major Majeur');
    });

    it('refuses a rename onto a name another board has, and the board keeps its name', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('rename-board-minor'));
        const dialog = await screen.findByRole('dialog');
        await userEvent.clear(within(dialog).getByLabelText('Board name'));
        await userEvent.type(within(dialog).getByLabelText('Board name'), 'Major');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

        // Said in the same sentence a create is refused with, and the dialog stays open on the
        // name that was refused, so another can be picked without starting over.
        expect(await screen.findByText('There is already a board called “Major”.'))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Board name')).toHaveValue('Major');
        expect(within(screen.getByTestId('board-row-minor')).getByText('Minor'))
            .toBeInTheDocument();
    });

    it('sends nothing when the rename is closed on the name the board already has', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('rename-board-major'));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(service.calls.filter(call => call.startsWith('renameBoard'))).toHaveLength(0);
    });

    it('deletes a board once the confirmation is answered, and only that board', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('delete-board-minor'));
        const dialog = await screen.findByRole('dialog');
        // The confirm renders its title twice — once shown, once for aria-labelledby — so the
        // shown one is named.
        const title = within(dialog).getByText('Delete “Minor”?',
            { selector: '.ant-modal-confirm-title' });
        expect(title).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(
            () => expect(screen.queryByTestId('board-row-minor')).not.toBeInTheDocument());
        expect(screen.getByTestId('board-row-major')).toBeInTheDocument();
        expect(service.calls).toContain('deleteBoard minor');
    });

    it('leaves a board alone when its delete is cancelled', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('delete-board-minor'));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByTestId('board-row-minor')).toBeInTheDocument();
        expect(service.calls.filter(call => call.startsWith('deleteBoard'))).toHaveLength(0);
    });

    // Made and then opened: the point of the dialog is the board you are about to work on. The
    // application is mounted under a base path — `/dashboard/` in production — so the jump has to go
    // through the router, which knows it. Written straight onto history it would land on
    // `/boards/…`, an address the application never answers on, so the page is mounted under a
    // basename here and what is asserted is that the router actually moved.
    it('opens the board it just made, under the base path the application is mounted at', async () => {
        renderPage('/dashboard');
        await rows();

        await userEvent.click(screen.getByRole('button', { name: /New board/ }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), 'Third');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

        expect(service.calls).toContain('createBoard Third');
        // The probe reads the address inside the application, which the basename is stripped from:
        // the board is open, and the URL the browser holds is `/dashboard/boards/third`.
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/boards/third'));
    });

    // A row is a box with a link in it rather than a link with buttons in it, so the two gestures
    // must not navigate — and the link must still open the board. A press that moved the router
    // is a press the probe shows.
    it('keeps the list under the gestures, and opens the board under the link', async () => {
        renderPage();
        await rows();

        await userEvent.click(screen.getByTestId('rename-board-major'));
        const renaming = await screen.findByRole('dialog');
        expect(screen.getByTestId('location')).toHaveTextContent('/boards');
        await userEvent.click(within(renaming).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        await userEvent.click(screen.getByTestId('delete-board-major'));
        const deleting = await screen.findByRole('dialog');
        expect(screen.getByTestId('location')).toHaveTextContent('/boards');
        await userEvent.click(within(deleting).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        await userEvent.click(within(screen.getByTestId('board-row-major')).getByRole('link'));
        expect(screen.getByTestId('location')).toHaveTextContent('/boards/major');
    });
});
