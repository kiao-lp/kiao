import { RefObject, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useLocation } from 'react-router-dom';
import { readDocumentText } from './documentText';
import { matchTextFragment } from './matchTextDirective';
import { clearPassage, paintPassage, revealPassage } from './passageHighlight';
import { parseTextFragment } from './textDirective';

/**
 * Opens a document on the passage its URL names: finds it, paints it, and scrolls it into place.
 *
 * The work is a loop rather than a single pass because there is nothing to search when the reader
 * arrives. The router settles first, then the file is fetched, then the markdown is rendered, then
 * images and diagrams change the height of everything above the passage. The loop keeps looking
 * until the text appears, and once it has, keeps the passage where it put it while the page around
 * it is still moving — then lets go, so the document is the reader's again.
 *
 * It lets go early the moment the reader touches anything. A link says where to open a document,
 * not where to keep it.
 */

/** How long to keep looking, and then holding. Past this the document is left as it is. */
const TIMEOUT_MS = 5000;

/** How still the passage must have stayed before the loop stops watching it. */
const HOLD_MS = 800;

/** The reader taking over, in the only forms that are unambiguously theirs and not the app's. */
const TAKE_OVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

const NOT_FOUND = 'That passage is not in this document any more.';

export interface TextFragmentState {
    /**
     * Whether the URL names a passage of this document. True for the whole visit, not only while
     * the passage is being placed: it is what tells a host that the link, and not the remembered
     * reading position, is what says where the document opens.
     */
    active: boolean;
}

export const useTextFragment = (
    scrollerRef: RefObject<HTMLElement | null>,
    enabled: boolean = true,
): TextFragmentState => {
    const { hash } = useLocation();
    const directives = useMemo(() => parseTextFragment(hash), [hash]);
    const active = enabled && directives.length > 0;

    useEffect(() => {
        if (!active) return;

        let frame = 0;
        let range: Range | null = null;
        /** The length of the text last searched: no point reading a document that has not changed. */
        let searched = -1;
        /** When the passage was last moved — the clock the hold below is measured against. */
        let movedAt = 0;
        let takenOver = false;
        const startedAt = Date.now();

        const takeOver = () => { takenOver = true; };
        TAKE_OVER_EVENTS.forEach(event =>
            window.addEventListener(event, takeOver, { capture: true, passive: true }));

        const tick = () => {
            frame = 0;
            if (takenOver) return;

            const now = Date.now();
            const expired = now - startedAt > TIMEOUT_MS;
            const scroller = scrollerRef.current;

            if (scroller?.isConnected) {
                // A re-render replaces the text nodes the range was built on, so a range whose
                // ends have left the document is searched for again rather than trusted.
                const broken = range !== null && !range.startContainer.isConnected;
                const length = scroller.textContent?.length ?? 0;
                if (broken || (range === null && length !== searched)) {
                    searched = length;
                    range = matchTextFragment(readDocumentText(scroller), directives);
                    if (range) {
                        paintPassage(range);
                        movedAt = now;
                    }
                }

                if (range) {
                    const before = scroller.scrollTop;
                    const placed = revealPassage(scroller, range);
                    // Held a moment past the last correction: an image or a diagram above the
                    // passage finishing late moves it, and each one has to be answered.
                    if (!placed || Math.abs(scroller.scrollTop - before) >= 1) movedAt = now;
                    else if (now - movedAt > HOLD_MS) return;
                }
            }

            if (expired) {
                if (!range) message.warning(NOT_FOUND);
                return;
            }
            frame = requestAnimationFrame(tick);
        };

        tick();

        return () => {
            if (frame) cancelAnimationFrame(frame);
            TAKE_OVER_EVENTS.forEach(event =>
                window.removeEventListener(event, takeOver, { capture: true }));
            clearPassage();
        };
    }, [active, directives, scrollerRef]);

    return { active };
};
