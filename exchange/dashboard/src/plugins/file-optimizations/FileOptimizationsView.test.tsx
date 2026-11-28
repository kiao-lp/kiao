import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from 'src/test/render';
import type { FileOptimizations } from 'kiao-worker';

const h = vi.hoisted(() => ({
    scan: vi.fn(async (): Promise<FileOptimizations> => ({
        duplicates: [], largest: [], scanned: 0, truncated: false,
    })),
    refreshFileList: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', async () => ({
    useConfirmation: (await import('src/core/ui-foundation/forms/ConfirmationDialog')).useConfirmation,
    useWorkerClient: () => ({ getFileOptimizations: h.scan }),
    useRefreshFileList: () => h.refreshFileList,
    InProgressFeedback: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

import { FileOptimizationsBody } from './FileOptimizationsView';

beforeEach(() => { vi.clearAllMocks(); });

describe('FileOptimizationsBody', () => {
    it('scans once on opening and again on request', async () => {
        render(<FileOptimizationsBody />);
        await screen.findByText('No file is stored twice — 0 files read.');
        expect(h.scan).toHaveBeenCalledTimes(1);

        let finish!: (result: FileOptimizations) => void;
        h.scan.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const rescan = screen.getByRole('button', { name: 'Re-scan' });
        fireEvent.click(rescan);
        expect(rescan).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Scanning files…');
        expect(screen.getByText('No file is stored twice — 0 files read.')).toBeVisible();
        fireEvent.click(rescan);
        expect(h.scan).toHaveBeenCalledTimes(2);
        await act(async () => { finish({ duplicates: [], largest: [], scanned: 1, truncated: false }); });
        expect(rescan).toBeEnabled();
    });

    it('rescans when closed and opened again', async () => {
        const { rerender } = render(<FileOptimizationsBody />);
        await screen.findByText('No file is stored twice — 0 files read.');
        rerender(<></>);
        rerender(<FileOptimizationsBody />);
        await waitFor(() => expect(h.scan).toHaveBeenCalledTimes(2));
    });

    it('reports a failed scan and retries on request', async () => {
        h.scan.mockRejectedValueOnce(new Error('Scan unavailable'));
        render(<FileOptimizationsBody />);
        await screen.findByText('Scan unavailable');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByText('No file is stored twice — 0 files read.');
        expect(h.scan).toHaveBeenCalledTimes(2);
    });
});
