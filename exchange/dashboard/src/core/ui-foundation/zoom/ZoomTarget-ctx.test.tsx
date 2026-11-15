import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from 'src/test/render';
import {
    ZoomTargetProvider, useZoomTarget, SELECTED_ATTR, MAX_ZOOM, MIN_ZOOM, INITIAL_ZOOM, LONG_PRESS_MS,
    LONG_PRESS_TOLERANCE_PX,
} from './ZoomTarget-ctx';
import { FLOATING_ATTR, PLACEHOLDER_ATTR } from './magnify';

/** Reads the context out, and offers the two ways the banner's slider drives it. */
const Probe: React.FC = () => {
    const { element, factor, setFactor } = useZoomTarget();
    return (
        <>
            <span data-testid="selected">{element?.id ?? 'none'}</span>
            <span data-testid="factor">{factor}</span>
            <button onClick={() => setFactor(1.5)}>magnify</button>
            <button onClick={() => setFactor(1)}>actual size</button>
            <button onClick={() => setFactor(4)}>overdo it</button>
            <button onClick={() => setFactor(0.1)}>underdo it</button>
        </>
    );
};

/**
 * A chat message with a diagram in it, a second message, and something that is neither. The first
 * one can be taken off the page, the way switching conversation takes a transcript off it.
 */
const Page: React.FC = () => {
    const [open, setOpen] = useState(true);
    const [tapped, setTapped] = useState(false);
    return (
        <ZoomTargetProvider>
            {open && (
                <div id="message" data-zoomable="">
                    <p>a reply</p>
                    <a href="/elsewhere.md">a link in the reply</a>
                    <div id="diagram" className="code-block-wrapper"><span>a picture</span></div>
                    <button onClick={() => setTapped(true)}>a button in the reply</button>
                    <textarea defaultValue="" aria-label="the note being written" />
                </div>
            )}
            <div id="other" data-zoomable="">another reply</div>
            <p>the composer</p>
            <span data-testid="tapped">{String(tapped)}</span>
            <button onClick={() => setOpen(false)}>switch conversation</button>
            <Probe />
        </ZoomTargetProvider>
    );
};

const page = () => render(<Page />);

/** How the reader picks a target: a click with Ctrl held down. */
const ctrlClick = (element: HTMLElement) => fireEvent.click(element, { ctrlKey: true });

/**
 * jsdom has no `PointerEvent`, and Testing Library's fallback `Event` drops `clientX` — half of
 * what tells a press from the beginning of a scroll. A `MouseEvent` named after the pointer event
 * carries it, and the provider listens on the document, so it reads exactly what a browser sends.
 */
const pointer = (type: string, target: Node, x = 0, pointerType = 'touch') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0 });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    fireEvent(target, event);
    return event;
};

/**
 * A finger put on an element, held, and lifted — with the tap the browser sends afterwards, since
 * swallowing that tap is half of what the gesture has to do.
 */
const longPress = (
    element: HTMLElement,
    { hold = LONG_PRESS_MS, moveBy = 0, pointerType = 'touch' } = {},
) => {
    pointer('pointerdown', element, 0, pointerType);
    if (moveBy) pointer('pointermove', element, moveBy, pointerType);
    act(() => { vi.advanceTimersByTime(hold); });
    pointer('pointerup', element, moveBy, pointerType);
    fireEvent.click(element);
};

const selected = () => screen.getByTestId('selected').textContent;
const factor = () => screen.getByTestId('factor').textContent;

describe('ZoomTargetProvider', () => {
    it('selects the message a Ctrl-click landed in', () => {
        page();
        ctrlClick(screen.getByText('a reply'));

        expect(selected()).toBe('message');
        expect(document.getElementById('message')!.hasAttribute(SELECTED_ATTR)).toBe(true);
    });

    it('selects the nearest zoomable, so a diagram wins over the message holding it', () => {
        page();
        ctrlClick(screen.getByText('a picture'));

        expect(selected()).toBe('diagram');
    });

    it('deselects on a second Ctrl-click', () => {
        page();
        ctrlClick(screen.getByText('a reply'));
        ctrlClick(screen.getByText('a reply'));

        expect(selected()).toBe('none');
        expect(document.getElementById('message')!.hasAttribute(SELECTED_ATTR)).toBe(false);
    });

    it('deselects on Escape', () => {
        page();
        ctrlClick(screen.getByText('a reply'));
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(selected()).toBe('none');
    });

    it('leaves the selection alone when a Ctrl-click lands nowhere near one', () => {
        page();
        ctrlClick(screen.getByText('a reply'));
        ctrlClick(screen.getByText('the composer'));

        expect(selected()).toBe('message');
    });

    it('leaves a plain click alone, whatever it lands on', () => {
        // Reading a reply, selecting a word in it, following a link inside it: the ordinary click
        // is the document's, and the magnifier only takes the one that is modified.
        page();
        fireEvent.click(screen.getByText('a reply'));

        expect(selected()).toBe('none');
    });

    it('leaves a Ctrl-click on a link alone, that being how it opens in a new tab', () => {
        page();
        ctrlClick(screen.getByText('a link in the reply'));

        expect(selected()).toBe('none');
    });

    it('opens every selection already magnified, whatever the last one was left at', () => {
        page();
        ctrlClick(screen.getByText('a reply'));
        // Ctrl-clicking to read something and getting the same size back would say nothing
        // happened, so a selection opens larger and the slider takes it from there.
        expect(factor()).toBe(String(INITIAL_ZOOM));

        fireEvent.click(screen.getByText('magnify'));
        expect(factor()).toBe('1.5');

        ctrlClick(screen.getByText('another reply'));
        expect(selected()).toBe('other');
        expect(factor()).toBe(String(INITIAL_ZOOM));
    });

    it('keeps the factor within the range the slider offers', () => {
        page();
        ctrlClick(screen.getByText('a reply'));

        fireEvent.click(screen.getByText('overdo it'));
        expect(factor()).toBe(String(MAX_ZOOM));
        fireEvent.click(screen.getByText('underdo it'));
        expect(factor()).toBe(String(MIN_ZOOM));
    });

    it('floats the element while it is magnified, and puts it back on Escape', () => {
        page();
        const message = document.getElementById('message')!;

        ctrlClick(screen.getByText('a reply'));
        expect(message.getAttribute(FLOATING_ATTR)).toBe(String(INITIAL_ZOOM));
        // The space it left is held open, so the page behind it has not moved.
        expect(document.querySelector(`[${PLACEHOLDER_ATTR}]`)).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(message.hasAttribute(FLOATING_ATTR)).toBe(false);
        expect(message.style.position).toBe('');
        expect(document.querySelector(`[${PLACEHOLDER_ATTR}]`)).toBeNull();
    });

    it('returns the element to the flow when the slider is brought back to its own size', () => {
        page();
        const message = document.getElementById('message')!;
        ctrlClick(screen.getByText('a reply'));

        fireEvent.click(screen.getByText('actual size'));

        // Still selected — still outlined, still what the slider drives — but nothing floats: at
        // 100% there is nothing to float, and leaving it out of the flow would be a change for
        // nothing.
        expect(selected()).toBe('message');
        expect(message.hasAttribute(SELECTED_ATTR)).toBe(true);
        expect(message.hasAttribute(FLOATING_ATTR)).toBe(false);
        expect(document.querySelector(`[${PLACEHOLDER_ATTR}]`)).toBeNull();
    });

    describe('the long press, which is Ctrl-click where there is no Ctrl key', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('picks the nearest zoomable of what was held, a diagram over the reply holding it', () => {
            page();
            longPress(screen.getByText('a picture'));

            expect(selected()).toBe('diagram');
            expect(factor()).toBe(String(INITIAL_ZOOM));
        });

        it('swallows the tap the press would otherwise also have been', () => {
            // The browser sends the click anyway, and running the button under the finger on top of
            // magnifying the reply around it is one gesture doing two things.
            page();
            longPress(screen.getByText('a button in the reply'));

            expect(selected()).toBe('message');
            expect(screen.getByTestId('tapped').textContent).toBe('false');
        });

        it('leaves a tap alone, however it lands', () => {
            page();
            longPress(screen.getByText('a reply'), { hold: LONG_PRESS_MS - 1 });

            expect(selected()).toBe('none');
            // And the tap that was never a press goes on being an ordinary tap.
            longPress(screen.getByText('a button in the reply'), { hold: LONG_PRESS_MS - 1 });
            expect(screen.getByTestId('tapped').textContent).toBe('true');
        });

        it('leaves a press that wanders alone, that being a scroll', () => {
            page();
            longPress(screen.getByText('a reply'), { moveBy: LONG_PRESS_TOLERANCE_PX + 1 });

            expect(selected()).toBe('none');
        });

        it('gives the press up when the platform takes the pointer for a gesture of its own', () => {
            page();
            pointer('pointerdown', screen.getByText('a reply'));
            pointer('pointercancel', screen.getByText('a reply'));
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });

            expect(selected()).toBe('none');
        });

        it('leaves a held mouse button alone, holding one down never having meant anything', () => {
            page();
            longPress(screen.getByText('a reply'), { pointerType: 'mouse' });

            expect(selected()).toBe('none');
        });

        it('leaves a link alone, that being how a phone offers to open it', () => {
            page();
            longPress(screen.getByText('a link in the reply'));

            expect(selected()).toBe('none');
        });

        it('leaves what is being typed in alone, a press there being how the caret is placed', () => {
            page();
            longPress(screen.getByLabelText('the note being written'));

            expect(selected()).toBe('none');
        });

        it('puts the element back on a second long press, as a second Ctrl-click does', () => {
            page();
            longPress(screen.getByText('a reply'));
            longPress(screen.getByText('a reply'));

            expect(selected()).toBe('none');
        });

        it('keeps the platform callout off a press it has taken', () => {
            page();
            const reply = screen.getByText('a reply');
            pointer('pointerdown', reply);
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });

            // Copy, share, look up: the menu belongs to the gesture, and the gesture is the zoom's.
            const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            fireEvent(reply, menu);
            expect(menu.defaultPrevented).toBe(true);
        });

        it('leaves the right click of a mouse its menu', () => {
            page();
            const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            fireEvent(screen.getByText('a reply'), menu);

            expect(menu.defaultPrevented).toBe(false);
        });
    });

    it('drops a selection whose element leaves the page', async () => {
        page();
        ctrlClick(screen.getByText('a reply'));
        expect(selected()).toBe('message');

        // A conversation switched, a document closed: the message is simply gone, and a selection
        // pointing at a detached node would keep the banner offering a slider for nothing.
        fireEvent.click(screen.getByText('switch conversation'));

        await waitFor(() => expect(selected()).toBe('none'));
    });
});
