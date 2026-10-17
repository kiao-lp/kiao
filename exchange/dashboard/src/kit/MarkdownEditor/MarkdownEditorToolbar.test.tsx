import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownEditorToolbar } from './MarkdownEditorToolbar';
import type { MarkdownEditorToolbarControlProps } from './useMarkdownEditorControls';

// The export modal has its own store reads; these assertions exercise the preview zoom controls.
vi.mock('./ExportModal', () => ({ ExportModal: () => null }));

/**
 * The preview's zoom is offered from the bar, and only while there is a preview to zoom: the bar
 * is the one place on screen that belongs to no pane, which is what keeps the control off the
 * document it resizes.
 */

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

/** rc-select renders its dropdown in a portal, so an option is found from the document. */
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

        // The first argument alone: the select hands its own option object along as a second.
        expect(setPreviewZoom.mock.calls[0][0]).toBe(1.5);
    });
});
