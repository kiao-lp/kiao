import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { EditorView } from '@codemirror/view';

/** Places the caret at the document end for `?cursor=end`. The param is removed via `replaceState` so reload does not jump again; enable only for the open document, not a section modal. */
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
