import React from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ATTRIBUTE } from './boardDom';
import { useSpotDrag } from './useSpotDrag';

/** Drag-to-place on the board canvas: what a card carried across the canvas writes when it is let go. */

const onMove = vi.fn();

const Host: React.FC<{ zoom?: number }> = ({ zoom }) => {
    const drag = useSpotDrag({ onMove, aimedAt: (id: string) => [id], zoom });
    return (
        <div {...{ [BOARD_ATTRIBUTE]: '' }} data-testid="canvas" style={{ overflow: 'auto' }}>
            <div data-testid="card" {...drag.dragProps('flow-node-1')}>
                card

                {createPortal(<div data-testid="portal-item">menu item</div>, document.body)}
            </div>
        </div>
    );
};

/** jsdom has no PointerEvent, and Testing Library's fallback Event drops clientX/clientY — the two. */
const pointer = (type: string, target: Element, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const canvas = () => screen.getByTestId('canvas') as HTMLElement;
const card = () => screen.getByTestId('card');

/** Drags the card from (fromX, fromY) and lets go at (toX, toY). */
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
        canvas().scrollLeft = 0;
        canvas().scrollTop = 0;
        pointer('pointermove', card(), 10, 10);
        pointer('pointerup', card(), 10, 10);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], -1190, -990);
    });

    it('counts the canvas box moving under the gesture', () => {
        onMove.mockClear();
        render(<Host />);
        placeCanvas(100, 50);

        pointer('pointerdown', card(), 300, 300);
        placeCanvas(60, 50);
        pointer('pointermove', card(), 110, 120);
        pointer('pointerup', card(), 110, 120);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], -150, -180);
    });

    it('writes nothing for a press that went nowhere', () => {
        onMove.mockClear();
        render(<Host />);

        pointer('pointerdown', card(), 200, 200);
        pointer('pointerup', card(), 201, 201);

        expect(onMove).not.toHaveBeenCalled();
    });

    it('measures the gesture through the zoom the board is read at', () => {
        onMove.mockClear();
        render(<Host zoom={0.5} />);

        dragTo(200, 200, 250, 260);

        expect(onMove).toHaveBeenCalledWith(['flow-node-1'], 100, 120);
    });

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
