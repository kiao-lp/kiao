import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { editorScrollDelta, editorTopLine, SOURCE_LINE_ATTRIBUTE } from '@cms-core';
import { offsetToSourceLine, sourceLineToOffset, SourceAnchor } from './scrollSync';

export interface UseMarkdownScrollSyncOptions {
    /** When false, both panes scroll independently. */
    enabled: boolean;
    /**
     * The source pane; null until it exists (and in the voice editor, which has
     * no line mapping). Must be state rather than a ref: CodeMirror builds its
     * view a render after mount, so reading a ref here would only ever see null.
     */
    view: EditorView | null;
    /**
     * The preview's scrollable element. Read through a getter because it is a ref:
     * unlike the view, it exists by the time this hook's effect runs, and hosts
     * only ever mount it alongside a pane change that already flips `enabled`.
     */
    getPreview: () => HTMLElement | null;
}

/** Where the preview's scrollable content starts, in viewport coordinates. */
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
    // Kept across renders so a scroll we caused is never mistaken for the user's,
    // which would bounce the panes back and forth.
    const programmatic = useRef({ editor: false, preview: false });

    useEffect(() => {
        if (!enabled) return;
        const preview = getPreview();
        if (!view || !preview) return;

        // Measuring every block on each scroll event is wasteful, so anchors live
        // until something can have moved them.
        let anchors: SourceAnchor[] | null = null;
        const measure = (): SourceAnchor[] => (anchors ??= collectAnchors(preview));
        const invalidate = () => { anchors = null; };

        const scrollBy = (element: HTMLElement, delta: number, pane: 'editor' | 'preview'): void => {
            if (Math.abs(delta) < 1) return;
            const before = element.scrollTop;
            programmatic.current[pane] = true;
            element.scrollTop = before + delta;
            // A scroll clamped to the end fires no event, which would otherwise
            // leave the guard set and swallow the user's next scroll.
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

        // Re-rendered markdown, images finishing, a diagram drawing itself or the
        // pane being resized all shift the anchors.
        const mutations = new MutationObserver(invalidate);
        mutations.observe(preview, { subtree: true, childList: true, characterData: true, attributes: true });
        const resizes = new ResizeObserver(invalidate);
        resizes.observe(preview);
        if (preview.firstElementChild) resizes.observe(preview.firstElementChild);

        // Turning sync on should align the panes rather than wait for a scroll.
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
