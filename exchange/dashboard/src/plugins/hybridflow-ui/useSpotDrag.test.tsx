import React from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ATTRIBUTE } from './boardDom';
import { useSpotDrag } from './useSpotDrag';

/**
 * Drag-to-place on the board canvas: what a card carried across the canvas
 * writes when it is let go.
 *
 * The distance is the gesture's own, in the canvas's coordinates — the
 * pointer's travel, plus whatever scrolled under it while it travelled. A
 * canvas that moved under the gesture by any other means has to count just
 * the same, or the card lands where the pointer is not.
 */

const onMove = vi.fn();

const Host: React.FC<{ zoom?: number }> = ({ zoom }) => {
    const drag = useSpotDrag({ onMove, aimedAt: (id: string) => [id], zoom });
    return (
        <div {...{ [BOARD_ATTRIBUTE]: '' }} data-testid="canvas" style={{ overflow: 'auto' }}>
            <div data-testid="card" {...drag.dragProps('flow-node-1')}>
                card
                {/* The card's menu, open over the canvas: a portal in the body, reached through
                    the React tree while standing outside the card in the DOM. */}
                {createPortal(<div data-testid="portal-item">menu item</div>, document.body)}
            </div>
        </div>
    );
};

/**
 * jsdom has no `PointerEvent`, and Testing Library's fallback `Event` drops
 * `clientX`/`clientY` — the two things a drag is made of. A `MouseEvent`
 * named after the pointer event carries them, and React dispatches on the
 * name. See `useBoardDrag.test.tsx`.
 */
const pointer = (type: string, target: Element, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const canvas = () => screen.getByTestId('canvas') as HTMLElement;
const card = () => screen.getByTestId('card');

/** Drags the card from `(fromX, fromY)` and lets go at `(toX, toY)`. */
const dragTo = (fromX: number, fromY: number, toX: number, toY: number) => {
    pointer('pointerdown', card(), fromX, fromY);
    pointer('pointermove', card(), toX, toY);
    pointer('pointerup', card(), toX, toY);
};

/** Where the canvas sits in the viewport, as the drag reads it off the document. */
const placeCanvas = (left: number, top: number) => {
    canvas().getBoundingClientRect = () =>
        ({ left, top, right: left + 800, bottom: top + 600 }) as DOMRect;
};

describe('useSpotDrag — where a card let go lands', () => {
    it('moves the card by the distance the pointer travelled', () => {
        onMove.mockClear();
        render(<Host />);

        dragTo(200, 200, 250, 260);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], 50, 60);
    });

    it('counts the canvas scrolling under the gesture', () => {
        onMove.mockClear();
        render(<Host />);
        canvas().scrollLeft = 1000;
        canvas().scrollTop = 800;

        pointer('pointerdown', card(), 200, 200);
        // Panned home mid-gesture, then let go at the viewport's corner.
        canvas().scrollLeft = 0;
        canvas().scrollTop = 0;
        pointer('pointermove', card(), 10, 10);
        pointer('pointerup', card(), 10, 10);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], -1190, -990);
    });

    // The canvas itself moving under the gesture — an outer scroller, a bar
    // opening, anything that shifts its box — moves the pointer's place on
    // the sheet by the same distance, so the travel counts it too. Without
    // it the card is let go a drift away from the pointer: dragged from a
    // far scrolled offset and dropped at the corner, it remains far.
    it('counts the canvas box moving under the gesture', () => {
        onMove.mockClear();
        render(<Host />);
        placeCanvas(100, 50);

        pointer('pointerdown', card(), 300, 300);
        // The canvas shifted left by 40 on screen; the pointer's place on
        // the sheet moved right by 40 with it.
        placeCanvas(60, 50);
        pointer('pointermove', card(), 110, 120);
        pointer('pointerup', card(), 110, 120);

        // In sheet coordinates the pointer went from 200 to 50 along x:
        // (110 - 60) - (300 - 100).
        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], -150, -180);
    });

    it('writes nothing for a press that went nowhere', () => {
        onMove.mockClear();
        render(<Host />);

        pointer('pointerdown', card(), 200, 200);
        pointer('pointerup', card(), 201, 201);

        expect(onMove).not.toHaveBeenCalled();
    });

    // The pointer travels in screen pixels and the cards sit in canvas ones: at half size a card
    // follows the pointer two canvas pixels for one on screen, so the card stays under it.
    it('measures the gesture through the zoom the board is read at', () => {
        onMove.mockClear();
        render(<Host zoom={0.5} />);

        dragTo(200, 200, 250, 260);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], 100, 120);
    });

    // A press from a portal — the card's menu, open over the canvas — bubbles through the React
    // tree to the card while its target stands outside it in the DOM. Answering it would capture
    // the pointer and swallow the click the menu is about: every item of every card menu going
    // dead without an error.
    it('answers no press that came from a portal outside the card', () => {
        onMove.mockClear();
        render(<Host />);
        const item = screen.getByTestId('portal-item');

        pointer('pointerdown', item, 200, 200);
        pointer('pointermove', item, 250, 260);
        pointer('pointerup', item, 250, 260);

        expect(onMove).not.toHaveBeenCalled();
    });
});
