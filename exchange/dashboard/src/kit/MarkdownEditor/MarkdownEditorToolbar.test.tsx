import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownEditorToolbar } from './MarkdownEditorToolbar';
import type { MarkdownEditorToolbarControlProps } from './useMarkdownEditorControls';

// The export modal has its own store reads; these assertions exercise the preview zoom controls.
vi.mock('./ExportModal', () => ({ ExportModal: () => null }));

// MarkdownEditorToolbar: export button and preview zoom.

const controls = (overrides: Partial<MarkdownEditorToolbarControlProps> = {}): MarkdownEditorToolbarControlProps => ({
    editorRef: { current: null },
    showSource: true,
    setShowSource: vi.fn(),
    showPreview: true,
    setShowPreview: vi.fn(),
    editorMode: 'codemirror',
    setEditorMode: vi.fn(),
    syncScroll: true,
    setSyncScroll: vi.fn(),
    previewZoom: 1,
    setPreviewZoom: vi.fn(),
    ...overrides,
});

const select = (): HTMLElement | null => document.querySelector('.markdown-preview-zoom .ant-select');

// Portal dropdown: query the document, not the container.
const option = (label: string): HTMLElement =>
    [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
        .find(item => item.textContent === label) as HTMLElement;

beforeEach(() => {
    // antd's popups measure themselves, and jsdom has no ResizeObserver.
    vi.stubGlobal('ResizeObserver', class {
        observe() { /* nothing to measure */ }
        unobserve() { /* nothing to measure */ }
        disconnect() { /* nothing to measure */ }
    });
});

describe('the markdown toolbar', () => {
    it.each([
        { showSource: false, showPreview: true, lastPane: 'Hide Preview', otherPane: 'Show Editor' },
        { showSource: true, showPreview: false, lastPane: 'Hide Editor', otherPane: 'Show Preview' },
    ])('keeps the last visible pane enabled: $lastPane', ({ showSource, showPreview, lastPane, otherPane }) => {
        const props = controls({ showSource, showPreview });
        render(<MarkdownEditorToolbar {...props} />);

        const toggle = screen.getByRole('button', { name: lastPane });
        expect(toggle).toBeDisabled();
        expect(screen.getByRole('button', { name: otherPane })).toBeEnabled();
        fireEvent.click(toggle);
        expect(props.setShowSource).not.toHaveBeenCalled();
        expect(props.setShowPreview).not.toHaveBeenCalled();
    });

    it('allows either pane to be hidden when both are visible', () => {
        const props = controls();
        render(<MarkdownEditorToolbar {...props} />);

        const editor = screen.getByRole('button', { name: 'Hide Editor' });
        const preview = screen.getByRole('button', { name: 'Hide Preview' });
        expect(editor).toBeEnabled();
        expect(preview).toBeEnabled();
        fireEvent.click(editor);
        fireEvent.click(preview);
        expect(props.setShowSource).toHaveBeenCalledWith(false);
        expect(props.setShowPreview).toHaveBeenCalledWith(false);
    });

    it('offers one export button instead of separate download buttons', () => {
        render(<MarkdownEditorToolbar {...controls()} />);

        expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Download as PDF' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Download as Word/ })).toBeNull();
    });

    it('offers the preview zoom, at the size the preview is being read at', () => {
        render(<MarkdownEditorToolbar {...controls({ previewZoom: 1.25 })} />);

        expect(select()).not.toBeNull();
        expect(screen.getByText('125%')).toBeInTheDocument();
    });

    it('says nothing about zoom while the preview is off', () => {
        render(<MarkdownEditorToolbar {...controls({ showPreview: false })} />);

        expect(select()).toBeNull();
    });

    it('reports the size that was picked', () => {
        const setPreviewZoom = vi.fn();
        render(<MarkdownEditorToolbar {...controls({ setPreviewZoom })} />);

        fireEvent.mouseDown(select()!.querySelector('.ant-select-selector, .ant-select-content')!);
        fireEvent.click(option('150%'));

        // First arg only; the second is the select's option object.
        expect(setPreviewZoom.mock.calls[0][0]).toBe(1.5);
    });
});
