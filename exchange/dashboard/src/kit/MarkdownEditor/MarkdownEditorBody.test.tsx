import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

/**
 * The preview is read at a size of its own, and that size is the reader's, not the layout's.
 *
 * Two things make it one rather than another way of resizing the pane: the zoom is set on a box
 * *inside* the scroller, so the pane keeps the column the layout gave it and goes on scrolling in
 * screen pixels; and changing it puts the reader back where they were reading, since laying the
 * document out again at another size moves every pixel offset in it. What "back where they were"
 * means is `previewAnchor`'s and is tested there; what is asserted here is that the pane is the
 * thing anchored, that it is anchored as it is read rather than only when it is resized, and that
 * a pane merely opening is left to the scroll memory that owns it.
 */

const anchor = vi.hoisted(() => ({ found: { element: document.createElement('p'), offset: -20 } }));
vi.mock('./previewAnchor', () => ({
    anchorAtTop: vi.fn(() => anchor.found),
    restoreAnchor: vi.fn(),
}));

vi.mock('@cms-core', async () => ({
    // The row the two panes are laid out in is the real one: what is under test here is which box
    // carries the zoom, and that is the box the row puts the preview in.
    SplitRow: (await vi.importActual<typeof import('src/cms-core/split')>('src/cms-core/split')).SplitRow,
    ConfiguredMarkdown: ({ children }: { children: string }) => <div data-testid="rendered">{children}</div>,
    extractName: (path: string) => path,
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
    useWorkerClient: () => ({}),
    useCodeMirrorScrollMemory: () => { /* the pane's own memory, not what is under test */ },
    useScrollMemory: () => { /* idem */ },
    // Passage links are off here (`passageLinks` defaults false), but the hook is called either way.
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

// What the editors hand the paste — the folder the image is offered to go in, the name it is made
// unique from, and whether its link is written from the store root.
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
        scrollMemory={false}
    />
);

/** Every box the render put a zoom on — one, and it is the preview's. */
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
        // The document is what is magnified...
        expect(box).toContainElement(getByTestId('rendered'));
        // ...and neither the pane that scrolls it nor the source beside it is.
        expect(box.parentElement!.style.overflow).toBe('auto');
        expect(box.parentElement!.style.zoom).toBeFalsy();
        expect(getByTestId('source')).not.toContainElement(box);
    });

    it('keeps the reader where they were reading when the size changes', () => {
        const { container, rerender } = render(body(1));
        const pane = zoomed(container)[0].parentElement!;

        // Reading down the document is what says where the reader is; the size is changed after.
        fireEvent.scroll(pane);
        expect(anchorAtTop).toHaveBeenCalledWith(pane);

        rerender(body(1.5));

        expect(restoreAnchor).toHaveBeenCalledWith(pane, anchor.found);
    });

    it('leaves a pane that is only opening to the memory that owns where it starts', () => {
        // A document reopened at the size it was left at: the size did not change, and putting the
        // pane back at a block nobody has read yet would fight the restored scroll offset.
        const { container, rerender } = render(body(1.5));
        rerender(body(1.5));

        expect(restoreAnchor).not.toHaveBeenCalled();
        expect(zoomed(container)[0].style.zoom).toBe('1.5');
    });
});

/**
 * A pasted image is offered to go beside the document being edited — the browsed file's folder,
 * which is what its link is written against too. A host editing something the store holds no
 * document for names both instead.
 */
describe('the pasted image', () => {
    it('is offered the browsed file’s folder, and linked against it', () => {
        // No file browsed here (see the context mock above): the store root, and a relative link.
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
                scrollMemory={false}
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
