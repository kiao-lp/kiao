import { RefObject, useEffect } from 'react';
import debounce from 'lodash.debounce';
import type { EditorView } from '@codemirror/view';
import { useFileBrowsingPersistenceContext } from 'src/cms-core/files/core/FileBrowsingPersistence-ctx';
import { editorScrollDelta, editorTopLine } from '../ui/codemirror/editorScroll';
import { useViewStateStore } from './ViewState-ctx';
import { roundLine, roundPixels } from './viewStateModel';

/** Every scroll container of a file shares this scope, one entry per container. */
const SCROLL_SCOPE = 'scroll';

/**
 * How long to keep trying to reach the stored offset. Content arrives after
 * mount — a fetch, images, CodeMirror measuring — so the container is usually
 * too short to scroll on the first frame.
 */
const RESTORE_TIMEOUT_MS = 2000;

/** Scrolling settles before the position is recorded; only the rest matters. */
const RECORD_DEBOUNCE_MS = 300;

/**
 * Read-modify-write against the live document rather than a cached copy: a page
 * has several containers (source pane, preview pane, one per tab) all writing
 * this one scope, and each must not undo the others.
 */
const useScrollWriter = (path: string) => {
    const store = useViewStateStore();
    return (key: string, value: number) => {
        if (!path) return;
        const current = store.getFileScope<Record<string, number>>(path, SCROLL_SCOPE, {});
        store.setFileScope(path, SCROLL_SCOPE, { ...current, [key]: value });
    };
};

const useStoredOffset = (path: string, key: string): number => {
    const store = useViewStateStore();
    if (!path) return 0;
    const stored = store.getFileScope<Record<string, number>>(path, SCROLL_SCOPE, {})[key];
    return typeof stored === 'number' && stored > 0 ? stored : 0;
};

/**
 * Restores a scroll container to where it was when this file was last open, and
 * records it as it moves.
 *
 * Restoration keeps re-applying the offset until the content is tall enough to
 * hold it, giving up after `RESTORE_TIMEOUT_MS` — or the instant the user
 * scrolls, since taking over must never be fought.
 *
 * @param ref       the element that actually scrolls (`overflow: auto`)
 * @param key       names this container within the file, e.g. `'main'`, `'preview'`
 * @param enabled   false while the container is hidden or its content not applicable
 */
export const useScrollMemory = (
    ref: RefObject<HTMLElement | null>,
    key: string,
    enabled: boolean = true,
): void => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const path = currentFile?.path ?? '';
    const write = useScrollWriter(path);
    const target = useStoredOffset(path, key);

    useEffect(() => {
        if (!enabled || !path) return;

        let element: HTMLElement | null = null;
        let restoring = target > 0;
        /**
         * Only a scroll the user made is worth writing. Without this, opening a
         * file and leaving would record a 0 for a container that never moved —
         * a meaningless entry in a git-tracked file for every file ever opened.
         * A completed restore needs no write either: it matches what is stored.
         */
        let userScrolled = false;
        let lastProgrammatic = -1;
        let frame = 0;
        const startedAt = Date.now();

        const record = debounce(() => {
            if (element) write(key, roundPixels(element.scrollTop));
        }, RECORD_DEBOUNCE_MS);

        const onScroll = () => {
            // Our own restoring assignments come back as scroll events; only a
            // move we did not make counts as the user taking over.
            if (restoring && Math.abs((element?.scrollTop ?? 0) - lastProgrammatic) < 1) return;
            restoring = false;
            userScrolled = true;
            record();
        };

        const attach = (el: HTMLElement) => {
            element = el;
            el.addEventListener('scroll', onScroll, { passive: true });
        };

        const tick = () => {
            frame = 0;
            const expired = Date.now() - startedAt > RESTORE_TIMEOUT_MS;

            if (!element) {
                const el = ref.current;
                if (el) attach(el);
                else {
                    if (!expired) frame = requestAnimationFrame(tick);
                    return;
                }
            }

            const el = element!;
            const max = el.scrollHeight - el.clientHeight;
            if (restoring) {
                if (max > 0) {
                    const next = Math.min(target, max);
                    if (Math.abs(el.scrollTop - next) >= 1) {
                        lastProgrammatic = next;
                        el.scrollTop = next;
                    }
                    if (max >= target) { restoring = false; return; }
                }
                if (expired) { restoring = false; return; }
                frame = requestAnimationFrame(tick);
            }
        };

        tick();

        return () => {
            if (frame) cancelAnimationFrame(frame);
            record.cancel();
            const el = element;
            if (el) {
                el.removeEventListener('scroll', onScroll);
                if (userScrolled) write(key, roundPixels(el.scrollTop));
            }
        };
        // `write`/`target` are read once per (path, key) restore cycle by design:
        // re-running on every store write would restart the restore mid-scroll.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, key, enabled]);
};

/**
 * The same, for a CodeMirror pane, storing the top **line** instead of a pixel
 * offset. Line coordinates survive reflow, a font change, and the document being
 * re-read from disk — a pixel offset does not.
 */
export const useCodeMirrorScrollMemory = (
    view: EditorView | null,
    key: string,
    enabled: boolean = true,
): void => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const path = currentFile?.path ?? '';
    const write = useScrollWriter(path);
    const target = useStoredOffset(path, key);

    useEffect(() => {
        if (!enabled || !path || !view) return;

        const scroller = view.scrollDOM;
        let restoring = target > 1;
        /** As above: only a move the user made is worth writing back. */
        let userScrolled = false;
        let lastProgrammatic = -1;
        let frame = 0;
        const startedAt = Date.now();

        const record = debounce(() => {
            write(key, roundLine(editorTopLine(view)));
        }, RECORD_DEBOUNCE_MS);

        const onScroll = () => {
            if (restoring && Math.abs(scroller.scrollTop - lastProgrammatic) < 1) return;
            restoring = false;
            userScrolled = true;
            record();
        };
        scroller.addEventListener('scroll', onScroll, { passive: true });

        const tick = () => {
            frame = 0;
            if (!restoring) return;
            // The document is loaded asynchronously; until it holds the stored
            // line there is nothing to scroll to.
            if (view.state.doc.lines >= Math.floor(target)) {
                const delta = editorScrollDelta(view, target);
                const next = Math.max(0, scroller.scrollTop + delta);
                if (Math.abs(delta) >= 1) {
                    lastProgrammatic = next;
                    scroller.scrollTop = next;
                }
                if (Math.abs(editorTopLine(view) - target) < 1) { restoring = false; return; }
            }
            if (Date.now() - startedAt > RESTORE_TIMEOUT_MS) { restoring = false; return; }
            frame = requestAnimationFrame(tick);
        };

        tick();

        return () => {
            if (frame) cancelAnimationFrame(frame);
            record.cancel();
            scroller.removeEventListener('scroll', onScroll);
            if (userScrolled) write(key, roundLine(editorTopLine(view)));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, key, enabled, view]);
};
