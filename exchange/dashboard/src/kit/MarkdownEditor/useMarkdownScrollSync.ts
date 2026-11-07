import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { editorScrollDelta, editorTopLine, SOURCE_LINE_ATTRIBUTE } from '@cms-core';
import { offsetToSourceLine, sourceLineToOffset, SourceAnchor } from './scrollSync';

export interface UseMarkdownScrollSyncOptions {
    enabled: boolean;
    /** Must be state, not a ref: the CodeMirror view appears a render after mount. */
    view: EditorView | null;
    /** Getter for the preview ref; it exists by effect time. */
    getPreview: () => HTMLElement | null;
}

const contentOrigin = (preview: HTMLElement): number => preview.getBoundingClientRect().top - preview.scrollTop;

const collectAnchors = (preview: HTMLElement): SourceAnchor[] => {
    const origin = contentOrigin(preview);
    return Array.from(preview.querySelectorAll(`[${SOURCE_LINE_ATTRIBUTE}]`)).map((element) => ({
        line: Number(element.getAttribute(SOURCE_LINE_ATTRIBUTE)),
        top: element.getBoundingClientRect().top - origin,
    }));
};

export const useMarkdownScrollSync = ({
    enabled,
    view,
    getPreview,
}: UseMarkdownScrollSyncOptions): void => {
    // Marks scrolls we caused, so they are not treated as user scrolls.
    const programmatic = useRef({ editor: false, preview: false });

    useEffect(() => {
        if (!enabled) return;
        const preview = getPreview();
        if (!view || !preview) return;

        // Anchors are cached until invalidated.
        let anchors: SourceAnchor[] | null = null;
        const measure = (): SourceAnchor[] => (anchors ??= collectAnchors(preview));
        const invalidate = () => { anchors = null; };

        const scrollBy = (element: HTMLElement, delta: number, pane: 'editor' | 'preview'): void => {
            if (Math.abs(delta) < 1) return;
            const before = element.scrollTop;
            programmatic.current[pane] = true;
            element.scrollTop = before + delta;
            // A clamped scroll fires no event; clear the guard or the next user scroll is swallowed.
            if (element.scrollTop === before) programmatic.current[pane] = false;
        };

        const syncPreviewToEditor = () => {
            const target = sourceLineToOffset(measure(), editorTopLine(view), view.state.doc.lines, preview.scrollHeight);
            scrollBy(preview, target - preview.scrollTop, 'preview');
        };

        const onEditorScroll = () => {
            if (programmatic.current.editor) {
                programmatic.current.editor = false;
                return;
            }
            syncPreviewToEditor();
        };

        const onPreviewScroll = () => {
            if (programmatic.current.preview) {
                programmatic.current.preview = false;
                return;
            }
            const line = offsetToSourceLine(measure(), preview.scrollTop, view.state.doc.lines, preview.scrollHeight);
            scrollBy(view.scrollDOM, editorScrollDelta(view, line), 'editor');
        };

        view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
        preview.addEventListener('scroll', onPreviewScroll, { passive: true });

        // Content or size changes shift the anchors.
        const mutations = new MutationObserver(invalidate);
        mutations.observe(preview, { subtree: true, childList: true, characterData: true, attributes: true });
        const resizes = new ResizeObserver(invalidate);
        resizes.observe(preview);
        if (preview.firstElementChild) resizes.observe(preview.firstElementChild);

        syncPreviewToEditor();

        return () => {
            view.scrollDOM.removeEventListener('scroll', onEditorScroll);
            preview.removeEventListener('scroll', onPreviewScroll);
            mutations.disconnect();
            resizes.disconnect();
            programmatic.current = { editor: false, preview: false };
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, view]);
};
