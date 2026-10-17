import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { useStickToBottom } from './useStickToBottom';

// ── Who the transcript scrolls for ────────────────────────────────────────────
//
// The reason this hook exists is the third test: a message arriving must not take the pane away from
// someone reading an earlier one. The rest is what makes that liveable — a reader at the bottom
// still gets the newest line without touching anything, going back down starts that again, and
// sending a message goes to the bottom whatever was being read.

/** How tall the pane is. Everything below is expressed against it. */
const VIEWPORT = 400;

/** The scroll position of a transcript that tall, read from the bottom: where following puts it. */
const bottomOf = (contentHeight: number) => contentHeight - VIEWPORT;

// ── A layout, since jsdom has none ────────────────────────────────────────────
//
// jsdom measures nothing: `scrollHeight` and `clientHeight` are 0, and `scrollTop` reads 0 whatever
// is written to it — so nothing this hook does would be visible. These three shadow the real ones
// for the length of a test, giving every div a height, a viewport and a position that remembers what
// it was set to. They go on `HTMLDivElement`, which jsdom does not define them on, so removing them
// is one `delete` each.

let contentHeight = 1000;
let scrollTops = new WeakMap<HTMLElement, number>();

beforeEach(() => {
    contentHeight = 1000;
    scrollTops = new WeakMap();
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
        configurable: true, get: () => contentHeight,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
        configurable: true, get: () => VIEWPORT,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) { return scrollTops.get(this) ?? 0; },
        set(this: HTMLElement, top: number) { scrollTops.set(this, top); },
    });
});

afterEach(() => {
    for (const measure of ['scrollHeight', 'clientHeight', 'scrollTop']) {
        delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[measure];
    }
});

const Harness: React.FC<{ messages: number }> = ({ messages }) => {
    const stick = useStickToBottom(messages);
    return (
        <>
            <div data-testid="transcript" ref={stick.ref} onScroll={stick.onScroll}>
                {messages} messages
            </div>
            <button type="button" onClick={() => stick.follow()}>Send</button>
        </>
    );
};

const transcript = () => screen.getByTestId('transcript');

/** A conversation on screen: mounted with its transcript already in it, as the pane does. */
const open = () => render(<Harness messages={1} />);

/** The reader moving the pane themselves — which is the only thing that stops the following. */
const readerScrollsTo = (top: number) => {
    transcript().scrollTop = top;
    fireEvent.scroll(transcript());
};

/** A message arrives: the transcript grows, and the pane decides whether to move. */
const newMessage = (view: ReturnType<typeof open>, grownTo: number) => {
    contentHeight = grownTo;
    view.rerender(<Harness messages={2} />);
};

describe('useStickToBottom', () => {
    it('opens a transcript at its newest message', () => {
        // Nothing changes after the mount here: the transcript is read before the pane is drawn, so
        // this is the ref arriving and not the effect.
        open();

        expect(transcript().scrollTop).toBe(bottomOf(1000));
    });

    it('follows the newest message for a reader who is at the bottom', () => {
        const view = open();

        newMessage(view, 1400);

        expect(transcript().scrollTop).toBe(bottomOf(1400));
    });

    it('leaves a reader who has scrolled back where they are', () => {
        const view = open();
        readerScrollsTo(120);

        newMessage(view, 1400);

        // The whole point: a turn streaming in must not drag the pane off the message being read.
        expect(transcript().scrollTop).toBe(120);
    });

    it('follows again once the reader scrolls back down', () => {
        const view = open();
        readerScrollsTo(120);

        readerScrollsTo(bottomOf(1000));
        newMessage(view, 1400);

        expect(transcript().scrollTop).toBe(bottomOf(1400));
    });

    it('counts a reader a few pixels off the bottom as being at it', () => {
        const view = open();
        // What a rounded height leaves behind, not a reader who scrolled anywhere.
        readerScrollsTo(bottomOf(1000) - 3);

        newMessage(view, 1400);

        expect(transcript().scrollTop).toBe(bottomOf(1400));
    });

    it('goes back to the bottom when a message is sent from higher up', () => {
        open();
        readerScrollsTo(120);

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(transcript().scrollTop).toBe(bottomOf(1000));
    });
});
