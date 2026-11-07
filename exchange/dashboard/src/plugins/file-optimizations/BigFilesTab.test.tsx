import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Modal } from 'antd';
import type { FileDto } from 'kiao-worker';

// Deletion covers only ticked files; nothing starts ticked.

vi.mock('@cms-core', async () => ({
    Tooltip: (await import('../../cms-core/ui-foundation/feedback/Tooltip')).Tooltip,
    useNavigation: () => ({ open: vi.fn(), openInNewTab: vi.fn(), openInNewWindow: vi.fn(), goUp: vi.fn(), goTo: vi.fn() }),
}));

import { BigFilesTab } from './BigFilesTab';

const MB = 1024 * 1024;
const file = (path: string, size: number): FileDto => ({ path, isDirectory: false, size, lastModified: 1_700_000_000_000 });

const LARGEST: FileDto[] = [
    file('media/intro.mp4', 400 * MB),
    file('media/outro.mp4', 200 * MB),
    file('scratch/dump.zip', 100 * MB),
];

const deleteFiles = vi.fn(async (_paths: string[]) => {});

const renderTab = () =>
    render(<BigFilesTab largest={LARGEST} scanned={42} truncated={false} deleteFiles={deleteFiles} />);

/** Tab button only; confirmation OK is in a portal. */
const deleteButton = () =>
    within(screen.getByTestId('big-files-tab')).getByRole('button', { name: /delete all/i });

describe('BigFilesTab', () => {
    beforeEach(() => { deleteFiles.mockClear(); });
    // antd confirmations outlive test cleanup in jsdom.
    afterEach(() => {
        Modal.destroyAll();
        document.body.innerHTML = '';
    });

    it('reaches nothing until a file is ticked, and says what it reaches once one is', async () => {
        renderTab();
        expect(deleteButton()).toBeDisabled();
        expect(screen.getByTestId('delete-summary')).toHaveTextContent('No file selected');

        await userEvent.click(screen.getByLabelText('Select media/outro.mp4'));
        expect(deleteButton()).toBeEnabled();
        expect(screen.getByTestId('delete-summary')).toHaveTextContent('1 file selected — 200 MB');
    });

    it('deletes every ticked file in one request, and none of the others', async () => {
        renderTab();
        await userEvent.click(screen.getByLabelText('Select media/intro.mp4'));
        await userEvent.click(screen.getByLabelText('Select scratch/dump.zip'));
        await userEvent.click(deleteButton());

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/\/media\/intro\.mp4/)).toBeInTheDocument();
        expect(within(dialog).getByText(/\/scratch\/dump\.zip/)).toBeInTheDocument();
        expect(within(dialog).queryByText(/outro/)).not.toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: /delete all/i }));

        expect(deleteFiles).toHaveBeenCalledTimes(1);
        expect(deleteFiles).toHaveBeenCalledWith(['media/intro.mp4', 'scratch/dump.zip']);
    });

    it('ticks every file listed from the header, and unticks them all from it', async () => {
        renderTab();
        const every = screen.getByLabelText('Select every file listed');

        await userEvent.click(every);
        expect(screen.getByTestId('delete-summary')).toHaveTextContent('3 files selected — 700 MB');

        await userEvent.click(every);
        expect(screen.getByTestId('delete-summary')).toHaveTextContent('No file selected');
        expect(deleteButton()).toBeDisabled();
    });

    it('does nothing when the confirmation is dismissed', async () => {
        renderTab();
        await userEvent.click(screen.getByLabelText('Select media/intro.mp4'));
        await userEvent.click(deleteButton());

        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

        expect(deleteFiles).not.toHaveBeenCalled();
    });
});
