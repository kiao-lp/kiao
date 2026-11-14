import { RefObject, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useLocation } from 'react-router-dom';
import { readDocumentText } from './documentText';
import { matchTextFragment } from './matchTextDirective';
import { clearPassage, paintPassage, revealPassage } from './passageHighlight';
import { parseTextFragment } from './textDirective';

/** Finds, paints and scrolls to the URL-named passage. Polls while rendering settles; releases on user input. */

/** Poll/hold timeout. */
const TIMEOUT_MS = 5000;

/** Stillness required before releasing the hold. */
const HOLD_MS = 800;

/** User-takeover events. */
const TAKE_OVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

const NOT_FOUND = 'That passage is not in this document any more.';

export interface TextFragmentState {
    /** True for the whole visit when the URL names a passage; overrides remembered position. */
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
        // Last searched text length.
        let searched = -1;
        // Last move time; the hold is measured from it.
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
                // Re-search if the range's nodes left the document.
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
                    // Late layout above the passage moves it; each move extends the hold.
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
