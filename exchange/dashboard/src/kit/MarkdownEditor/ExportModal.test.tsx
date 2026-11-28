import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const themes = vi.hoisted(() => ([
    { id: 'neutral', label: 'Default' },
    { id: 'company', label: 'Company' },
]));
const client = vi.hoisted(() => ({}));

vi.mock('@kiao-dashboard-core', () => ({
    DEFAULT_PDF_THEME: { id: 'neutral', label: 'Default' },
    loadPdfThemes: vi.fn(async () => themes),
    useWorkerClient: () => client,
}));

import { loadPdfThemes } from '@kiao-dashboard-core';
import { ExportModal } from './ExportModal';

const props = (overrides: Partial<React.ComponentProps<typeof ExportModal>> = {}) => ({
    open: true,
    onClose: vi.fn(),
    onExportPdf: vi.fn(),
    onExportDocx: vi.fn(async () => {}),
    ...overrides,
});

beforeEach(() => {
    vi.mocked(loadPdfThemes).mockClear();
});

describe('the export modal', () => {
    it('reads the store themes on open, and exports the default PDF at once', async () => {
        const { onClose, onExportPdf, onExportDocx } = props();
        render(<ExportModal open onClose={onClose} onExportPdf={onExportPdf} onExportDocx={onExportDocx} />);

        expect(await screen.findByRole('radio', { name: 'Default' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'PDF' })).toBeChecked();
        const submit = screen.getByRole('button', { name: 'Export' });
        await waitFor(() => expect(submit).not.toHaveClass('ant-btn-loading'));
        fireEvent.click(submit);

        expect(loadPdfThemes).toHaveBeenCalled();
        expect(onExportPdf).toHaveBeenCalledWith(themes[0]);
        expect(onExportDocx).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('exports Word with the theme picked', async () => {
        let finish!: () => void;
        const { onClose, onExportPdf, onExportDocx } = props({
            onExportDocx: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })),
        });
        render(<ExportModal open onClose={onClose} onExportPdf={onExportPdf} onExportDocx={onExportDocx} />);

        fireEvent.click(await screen.findByRole('radio', { name: 'Company' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Word (.docx)' }));
        const submit = screen.getByRole('button', { name: 'Export' });
        await waitFor(() => expect(submit).not.toHaveClass('ant-btn-loading'));
        fireEvent.click(submit);

        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('radio', { name: 'PDF' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Default' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await waitFor(() => expect(onExportDocx).toHaveBeenCalledWith(themes[1]));
        expect(onExportPdf).not.toHaveBeenCalled();
        await act(async () => { finish(); });
        expect(onClose).toHaveBeenCalled();
    });

    it('waits for themes before it can export', async () => {
        let finish!: (loaded: typeof themes) => void;
        vi.mocked(loadPdfThemes).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const p = props();
        render(<ExportModal {...p} />);

        const submit = screen.getByRole('button', { name: 'Export' });
        expect(submit).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Loading themes…');
        fireEvent.click(submit);
        expect(p.onExportPdf).not.toHaveBeenCalled();

        await act(async () => { finish(themes); });
        expect(submit).toBeEnabled();
    });

    it('reads nothing while closed', () => {
        const p = props({ open: false });
        render(<ExportModal {...p} />);

        expect(loadPdfThemes).not.toHaveBeenCalled();
    });
});
