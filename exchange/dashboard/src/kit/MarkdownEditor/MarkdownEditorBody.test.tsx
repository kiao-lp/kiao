import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

// MarkdownEditorBody: preview zoom placement and anchor restore.

const anchor = vi.hoisted(() => ({ found: { element: document.createElement('p'), offset: -20 } }));
vi.mock('./previewAnchor', () => ({
    anchorAtTop: vi.fn(() => anchor.found),
    restoreAnchor: vi.fn(),
}));

vi.mock('@cms-core', async () => ({
    // Real SplitRow: the test checks which box it puts the zoom on.
    SplitRow: (await vi.importActual<typeof import('src/cms-core/ui-foundation/layout')>('src/cms-core/ui-foundation/layout')).SplitRow,
    ConfiguredMarkdown: ({ children }: { children: string }) => <div data-testid="rendered">{children}</div>,
    extractName: (path: string) => path,
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
    useWorkerClient: () => ({}),
    // Hook is called even with passageLinks off; mock it.
    useTextFragment: () => ({ active: false }),
    PassageContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    VoiceTextArea: () => <textarea />,
    parentPath: (path: string) => path,
    printMarkdownToPdf: vi.fn(),
    SOURCE_LINE_ATTRIBUTE: 'data-source-line',
}));
vi.mock('./CodeMirrorMarkdownEditor', () => ({
    CodeMirrorMarkdownEditor: React.forwardRef(() => <div data-testid="source" />),
}));

const pasteTo = vi.hoisted(() => ({ folder: '', name: '', linkFromRoot: false }));
vi.mock('./useImagePaste', () => ({
    useImagePaste: (folder: string, documentName: string, _insert: (snippet: string) => void, linkFromRoot = false) => {
        pasteTo.folder = folder;
        pasteTo.name = documentName;
        pasteTo.linkFromRoot = linkFromRoot;
        return { onPasteCapture: vi.fn(), modalProps: { image: null } };
    },
}));
vi.mock('./useCursorFromQuery', () => ({ useCursorFromQuery: () => { /* not what is under test */ } }));
vi.mock('./ImagePasteModal', () => ({ ImagePasteModal: () => null }));
vi.mock('./ArchDiaBlockModal', () => ({ ArchDiaBlockModal: () => null }));
vi.mock('./ArchDiaExtractModal', () => ({ ArchDiaExtractModal: () => null }));

import { anchorAtTop, restoreAnchor } from './previewAnchor';
import { MarkdownEditorBody } from './MarkdownEditorBody';

const body = (previewZoom: number) => (
    <MarkdownEditorBody
        value="# heading"
        onChange={() => { /* not what is under test */ }}
        previewZoom={previewZoom}
    />
);

const zoomed = (container: HTMLElement): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>('div')].filter(element => Boolean(element.style.zoom));

beforeEach(() => {
    vi.mocked(anchorAtTop).mockClear();
    vi.mocked(restoreAnchor).mockClear();
});

describe('the markdown preview zoom', () => {
    it('draws the document in a box of its own, inside the pane rather than around it', () => {
        const { container, getByTestId } = render(body(1.25));

        const [box, ...others] = zoomed(container);
        expect(others).toEqual([]);
        expect(box.style.zoom).toBe('1.25');
        expect(box).toContainElement(getByTestId('rendered'));
        expect(box.parentElement!.style.overflow).toBe('auto');
        expect(box.parentElement!.style.zoom).toBeFalsy();
        expect(getByTestId('source')).not.toContainElement(box);
    });

    it('keeps the reader where they were reading when the size changes', () => {
        const { container, rerender } = render(body(1));
        const pane = zoomed(container)[0].parentElement!;

        fireEvent.scroll(pane);
        expect(anchorAtTop).toHaveBeenCalledWith(pane);

        rerender(body(1.5));

        expect(restoreAnchor).toHaveBeenCalledWith(pane, anchor.found);
    });

    it('leaves a pane that is only opening where it starts', () => {
        // Same zoom on rerender: no restore.
        const { container, rerender } = render(body(1.5));
        rerender(body(1.5));

        expect(restoreAnchor).not.toHaveBeenCalled();
        expect(zoomed(container)[0].style.zoom).toBe('1.5');
    });
});

// Pasted image folder and link base.
describe('the pasted image', () => {
    it('is offered the browsed file’s folder, and linked against it', () => {
        // No file browsed in the mock: store root, relative link.
        render(body(1));

        expect(pasteTo.folder).toBe('');
        expect(pasteTo.name).toBe('image');
        expect(pasteTo.linkFromRoot).toBe(false);
    });

    it('takes the host’s folder, name and link style where the host names them', () => {
        render(
            <MarkdownEditorBody
                value=""
                onChange={() => { /* not what is under test */ }}
                imageFolder="boards/major"
                imageDocumentName="major"
                imageLinksFromRoot
            />,
        );

        expect(pasteTo.folder).toBe('boards/major');
        expect(pasteTo.name).toBe('major');
        expect(pasteTo.linkFromRoot).toBe(true);
    });
});
