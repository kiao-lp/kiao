import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const themes = vi.hoisted(() => ([
    { id: 'neutral', label: 'Default' },
    { id: 'company', label: 'Company' },
]));

vi.mock('@cms-core', () => ({
    DEFAULT_PDF_THEME: { id: 'neutral', label: 'Default' },
    loadPdfThemes: vi.fn(async () => themes),
    useWorkerClient: () => ({}),
}));

import { loadPdfThemes } from '@cms-core';
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

        fireEvent.click(await screen.findByRole('radio', { name: 'Company' }));
        fireEvent.click(screen.getByRole('radio', { name: 'PDF' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        expect(loadPdfThemes).toHaveBeenCalled();
        expect(onExportPdf).toHaveBeenCalledWith(themes[0]);
        expect(onExportDocx).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('exports Word with the theme picked', async () => {
        const { onClose, onExportPdf, onExportDocx } = props();
        render(<ExportModal open onClose={onClose} onExportPdf={onExportPdf} onExportDocx={onExportDocx} />);

        fireEvent.click(await screen.findByRole('radio', { name: 'Company' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Word (.docx)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        await waitFor(() => expect(onExportDocx).toHaveBeenCalledWith(themes[1]));
        expect(onExportPdf).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('reads nothing while closed', () => {
        const p = props({ open: false });
        render(<ExportModal {...p} />);

        expect(loadPdfThemes).not.toHaveBeenCalled();
    });
});
