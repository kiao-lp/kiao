import { useCallback, useEffect, useRef } from 'react';

// Allow for rounded scroll metrics near the bottom.
const BOTTOM_SLACK_PX = 32;

export interface StickToBottom {
    /** Attach ref and onScroll to the same scrolling element. */
    ref: (el: HTMLDivElement | null) => void;
    onScroll: () => void;
    /** Resume following, even if the reader scrolled away. */
    follow: () => void;
}

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;

// Keep scrolling instant: smooth-scroll events would look like the reader scrolled away.
const toBottom = (el: HTMLElement) => { el.scrollTop = el.scrollHeight - el.clientHeight; };

/** Follow content changes until the reader scrolls away; content is only a change trigger. */
export const useStickToBottom = (content: unknown): StickToBottom => {
    const container = useRef<HTMLDivElement | null>(null);
    // Avoid rerendering the transcript on every scroll event.
    const stuck = useRef(true);

    // Loaded transcripts can mount without another content change. The callback ref runs
    // after children are in the DOM, so their final height is available.
    const ref = useCallback((el: HTMLDivElement | null) => {
        container.current = el;
        if (el && stuck.current) toBottom(el);
    }, []);

    const onScroll = useCallback(() => {
        const el = container.current;
        if (el) stuck.current = atBottom(el);
    }, []);

    const follow = useCallback(() => {
        stuck.current = true;
        if (container.current) toBottom(container.current);
    }, []);

    useEffect(() => {
        const el = container.current;
        if (el && stuck.current) toBottom(el);
    }, [content]);

    return { ref, onScroll, follow };
};
