import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { EditorView } from '@codemirror/view';

/**
 * Puts the caret where a fresh tab was asked to: `?cursor=end` means the end of the document.
 *
 * Written for the backlog a passage was just added to — the new tab opens on the section appended
 * at the end, and the caret lands after the link so the comment is typed where it belongs. The
 * preview scrolls there through its own `#text=` fragment (see `useTextFragment`); this is the
 * source pane's half.
 *
 * The query is consumed once the caret is placed, through `replaceState` rather than a router
 * navigation: reloading must reopen where the reader left off, not jump back to the end. Only the
 * open file answers — a modal editing a section of it has no end worth jumping to, so hosts that
 * are not the document itself keep this off.
 */
export const useCursorFromQuery = (view: EditorView | null, enabled: boolean): void => {
    const { pathname, search, hash } = useLocation();

    useEffect(() => {
        if (!enabled) return;
        if (new URLSearchParams(search).get('cursor') !== 'end') return;
        if (!view) return;

        view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
        view.focus();

        const params = new URLSearchParams(search);
        params.delete('cursor');
        const rest = params.toString();
        window.history.replaceState(null, '', pathname + (rest ? `?${rest}` : '') + hash);
    }, [enabled, pathname, search, hash, view]);
};
