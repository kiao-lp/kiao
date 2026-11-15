import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileOptimizations } from 'kiao-worker';

const h = vi.hoisted(() => ({
    scan: vi.fn(async (): Promise<FileOptimizations> => ({
        duplicates: [], largest: [], scanned: 0, truncated: false,
    })),
    refreshFileList: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', () => ({
    useWorkerClient: () => ({ getFileOptimizations: h.scan }),
    useRefreshFileList: () => h.refreshFileList,
}));

import { FileOptimizationsBody } from './FileOptimizationsView';

beforeEach(() => { vi.clearAllMocks(); });

describe('FileOptimizationsBody', () => {
    it('scans once on opening and again on request', async () => {
        render(<FileOptimizationsBody />);
        await screen.findByText('No file is stored twice — 0 files read.');
        expect(h.scan).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Re-scan/ }));
        await waitFor(() => expect(h.scan).toHaveBeenCalledTimes(2));
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
