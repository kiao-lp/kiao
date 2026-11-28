import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from 'src/test/render';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Modal, message } from 'antd';

const currentBoard = vi.hoisted(() => ({ handle: null as string | null }));
vi.mock('../Hybridflow-ctx', () => ({ useHybridflow: () => currentBoard }));

import { BoardsCatalogProvider } from '../BoardsCatalog-ctx';
import { BoardsPanel } from './BoardsPanel';
import { BoardSummary, FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { BOARD_ARCHIVE_VERSION, readFileText } from '../boardArchive';
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
    currentBoard.handle = null;
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
    service.boardsList = [
        board({ slug: 'major', name: 'Major', updatedAt: '2026-09-10T10:00:00.000Z' }),
        board({ slug: 'minor', name: 'Minor', updatedAt: '2026-09-01T10:00:00.000Z' }),
    ];
});

afterEach(() => {
    Modal.destroyAll();
    message.destroy();
});

/** Where the router stands, so a press that navigated is a press that shows. */
const LocationProbe: React.FC = () => {
    const { pathname } = useLocation();
    return <span data-testid="location">{pathname}</span>;
};

const renderPanel = () => render(
    <MemoryRouter initialEntries={['/units/abc/cadre.md']}>
        <HybridflowClientProvider client={service.asClient()}>
            <LocationProbe />
            <BoardsCatalogProvider><BoardsPanel /></BoardsCatalogProvider>
        </HybridflowClientProvider>
    </MemoryRouter>,
);

const rows = () => screen.findAllByTestId(/board-row-/);
const chooseBoardAction = async (slug: string, name: string) => {
    fireEvent.contextMenu(within(screen.getByTestId(`board-row-${slug}`)).getByRole('link'));
    await userEvent.click(await screen.findByRole('menuitem', { name }));
};

// What the download offered: jsdom mints no object URLs, and a real click on an anchor asks it to navigate somewhere it cannot go —.
const offeredBlobs: Blob[] = [];
const offeredClicks: HTMLAnchorElement[] = [];

beforeEach(() => {
    offeredBlobs.length = 0;
    offeredClicks.length = 0;
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
        offeredBlobs.push(blob as Blob);
        return 'blob:download';
    };
    URL.revokeObjectURL = (): void => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        offeredClicks.push(this);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('BoardsPanel', () => {
    it('recovers from a read failure and lists folders even when there are no boards', async () => {
        service.boardsList = [];
        vi.spyOn(service, 'boardFolders')
            .mockRejectedValueOnce(new Error('Store unavailable'))
            .mockResolvedValueOnce([{ id: 'planning', name: 'Planning' }]);

        renderPanel();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Store unavailable');
        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('button', { name: 'Planning' })).toBeInTheDocument();
        expect(screen.queryByText('No boards yet.')).toBeNull();
    });

    it('lists every board, each opening its own address, without the handles and hours', async () => {
        renderPanel();

        expect(screen.getByTestId('boards-panel')).toBeInTheDocument();
        const held = await rows();
        expect(held).toHaveLength(2);
        expect(within(held[0]).getByRole('link')).toHaveAttribute('href', '/boards/major');
        expect(within(held[0]).getByText('Major')).toBeInTheDocument();
        expect(within(held[0]).queryByText('/major')).not.toBeInTheDocument();
        expect(screen.queryByText('Boards', { selector: 'span' })).not.toBeInTheDocument();
    });

    it('lists boards in alphabetical order, whatever was touched last', async () => {
        service.boardsList = [
            board({ slug: 'zebra', name: 'Zebra', updatedAt: '2026-09-10T10:00:00.000Z' }),
            board({ slug: 'alpha', name: 'Alpha', updatedAt: '2026-09-01T10:00:00.000Z' }),
        ];
        renderPanel();

        const held = await rows();
        expect(held).toHaveLength(2);
        expect(within(held[0]).getByText('Alpha')).toBeInTheDocument();
        expect(within(held[1]).getByText('Zebra')).toBeInTheDocument();
    });

    it('opens the board it just made, leaving the document it was opened from', async () => {
        renderPanel();
        await rows();

        await userEvent.click(screen.getByRole('button', { name: 'Create board or folder' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'New board' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), 'Third');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

        expect(service.calls).toContain('createBoard Third');
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/boards/third'));
    });

    it('renames a board from its row, like the page does', async () => {
        renderPanel();
        await rows();

        await chooseBoardAction('major', 'Rename');
        const dialog = await screen.findByRole('dialog');
        await userEvent.clear(within(dialog).getByLabelText('Board name'));
        await userEvent.type(within(dialog).getByLabelText('Board name'), 'Majeur');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

        const row = await screen.findByTestId('board-row-major');
        expect(within(row).getByText('Majeur')).toBeInTheDocument();
        expect(service.calls).toContain('renameBoard major Majeur');
    });

    it('holds the entered board name while creation is in progress', async () => {
        let fail!: (cause: Error) => void;
        const create = vi.spyOn(service, 'createBoard').mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
        renderPanel();
        await rows();
        await userEvent.click(screen.getByRole('button', { name: 'Create board or folder' }));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'New board' }));
        const dialog = within(await screen.findByRole('dialog'));
        const name = dialog.getByRole('textbox');
        fireEvent.change(name, { target: { value: 'Third' } });
        const submit = dialog.getByRole('button', { name: 'Create' });
        fireEvent.click(submit);

        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(name).toHaveAttribute('readonly');
        expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        fireEvent.keyDown(name, { key: 'Enter', code: 'Enter' });
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith('Third', undefined);

        await act(async () => { fail(new Error('Unavailable')); });
        expect(name).not.toHaveAttribute('readonly');
        expect(name).toHaveValue('Third');
    });

    it('downloads the board its row names as one JSON file', async () => {
        service.summary = { ...service.summary, name: 'Major', slug: 'major' };
        renderPanel();
        await rows();

        await chooseBoardAction('major', 'Download');

        expect(service.calls).toContain('board major');
        await waitFor(() => expect(offeredBlobs).toHaveLength(1));
        const parsed = JSON.parse(await readFileText(offeredBlobs[0])) as {
            kind: string; name: string; flowNodes: unknown[];
        };
        expect(parsed.kind).toBe('kiao-board');
        expect(parsed.name).toBe('Major');
        expect(parsed.flowNodes).toEqual([]);
        expect(offeredClicks).toHaveLength(1);
        expect(offeredClicks[0].download).toBe('major.json');
    });

    it('imports a downloaded file onto a fresh board and opens it', async () => {
        renderPanel();
        await rows();

        const file = new File([JSON.stringify({
            kind: 'kiao-board', version: BOARD_ARCHIVE_VERSION, name: 'Imported',
            flowNodes: [], workflows: [],
        })], 'imported.json', { type: 'application/json' });
        fireEvent.change(screen.getByTestId('import-board-input'), { target: { files: [file] } });

        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/boards/imported'));
        expect(service.calls).toContain('createBoard Imported');
    });

    it('refuses a file that is not a board download', async () => {
        renderPanel();
        await rows();

        const file = new File(['not a board'], 'nope.json', { type: 'application/json' });
        fireEvent.change(screen.getByTestId('import-board-input'), { target: { files: [file] } });

        await screen.findByText('This file is not a board download.');
        expect(service.calls.filter(call => call.startsWith('createBoard'))).toHaveLength(0);
    });

    it('deletes a board once the confirmation is answered, and only that board', async () => {
        renderPanel();
        await rows();

        await chooseBoardAction('minor', 'Delete');
        const dialog = await screen.findByRole('dialog', { name: 'Delete “Minor”?' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(
            () => expect(screen.queryByTestId('board-row-minor')).not.toBeInTheDocument());
        expect(screen.getByTestId('board-row-major')).toBeInTheDocument();
        expect(service.calls).toContain('deleteBoard minor');
    });

    it('leaves a board alone when its delete is cancelled', async () => {
        renderPanel();
        await rows();

        await chooseBoardAction('minor', 'Delete');
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByTestId('board-row-minor')).toBeInTheDocument();
        expect(service.calls.filter(call => call.startsWith('deleteBoard'))).toHaveLength(0);
    });

    it('marks the open board as selected while a document URL is active', async () => {
        currentBoard.handle = 'major';
        renderPanel();

        const major = await screen.findByTestId('board-row-major');
        const minor = await screen.findByTestId('board-row-minor');
        expect(major.className).toMatch(/selected/);
        expect(within(major).getByRole('link')).toHaveAttribute('aria-current', 'page');
        expect(minor.className).not.toMatch(/selected/);
        expect(within(minor).getByRole('link')).not.toHaveAttribute('aria-current');
    });
});
