import React from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CardBox } from './boardSpots';
import { BoxSelect, useBoxSelect } from './useBoxSelect';

/** Box selection on the board canvas: the cards the box covers, reported live as it moves — and only. */

const onStart = vi.fn();
const onChange = vi.fn();
const onCancel = vi.fn();

const BOXES = new Map<string, CardBox>([
    ['a', { x: 0, y: 0, w: 100, h: 100 }],
    ['b', { x: 200, y: 0, w: 100, h: 100 }],
    ['c', { x: 0, y: 200, w: 100, h: 100 }],
]);

/** The hook as the canvas holds it — the rect it draws, and the box itself for the rest. */
let held: BoxSelect | null = null;

const Host: React.FC<{ zoom?: number }> = ({ zoom }) => {
    const box = useBoxSelect({ boxes: BOXES, zoom, onStart, onChange, onCancel });
    held = box;
    return (
        <div data-testid="canvas" style={{ overflow: 'auto' }} {...box.boxProps}>
            <div data-testid="card" data-flow-node-id="a">card</div>
            <div data-testid="workflow" data-workflow-id="w1">rectangle</div>

            {createPortal(<div data-testid="portal-item">menu item</div>, document.body)}
            {box.rect && (
                <div
                    data-testid="box"
                    data-x={box.rect.x}
                    data-y={box.rect.y}
                    data-w={box.rect.w}
                    data-h={box.rect.h}
                />
            )}
        </div>
    );
};

/** jsdom has no PointerEvent, and Testing Library's fallback Event drops clientX/clientY — the two. */
const pointer = (
    type: string, target: Element, clientX: number, clientY: number,
    over: { ctrlKey?: boolean; metaKey?: boolean; button?: number } = {},
) => {
    const event = new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX, clientY, button: over.button ?? 0,
        ctrlKey: over.ctrlKey ?? false, metaKey: over.metaKey ?? false,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const canvas = () => screen.getByTestId('canvas') as HTMLElement;
const card = () => screen.getByTestId('card');
const workflow = () => screen.getByTestId('workflow');
const portalItem = () => screen.getByTestId('portal-item');
const box = () => screen.queryByTestId('box') as HTMLElement | null;

/** Pulls a box from (fromX, fromY) to (toX, toY) and lets go there. */
const pullTo = (
    fromX: number, fromY: number, toX: number, toY: number,
    over: { ctrlKey?: boolean; metaKey?: boolean } = {},
) => {
    pointer('pointerdown', canvas(), fromX, fromY, over);
    pointer('pointermove', canvas(), toX, toY, over);
    pointer('pointerup', canvas(), toX, toY, over);
};

beforeEach(() => {
    vi.clearAllMocks();
    held = null;
});

describe('useBoxSelect — the cards a box picks out', () => {
    it('reports them live, as the box moves', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 0, 0);
        expect(onStart).not.toHaveBeenCalled();

        pointer('pointermove', canvas(), 150, 150);
        expect(onStart).toHaveBeenCalledWith(false);
        expect(onChange).toHaveBeenLastCalledWith(['a']);

        pointer('pointermove', canvas(), 250, 150);
        expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);

        pointer('pointerup', canvas(), 250, 150);
        expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    });

    it('reads a box pulled up and left the same as one pulled down and right', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 250, 150);
        pointer('pointermove', canvas(), 0, 0);

        expect(box()?.dataset).toMatchObject({ x: '0', y: '0', w: '250', h: '150' });
        expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);

        pointer('pointerup', canvas(), 0, 0);
        expect(box()).toBeNull();
    });

    it('draws the box while it is out, and takes it away at the release', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 10, 20);
        pointer('pointermove', canvas(), 60, 80);

        const drawn = box();
        expect(drawn?.dataset).toMatchObject({ x: '10', y: '20', w: '50', h: '60' });

        pointer('pointerup', canvas(), 60, 80);
        expect(box()).toBeNull();
    });

    it('reports a set once, however many moves take it', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 0, 0);
        pointer('pointermove', canvas(), 50, 50);
        pointer('pointermove', canvas(), 60, 60);
        pointer('pointermove', canvas(), 70, 70);
        pointer('pointerup', canvas(), 70, 70);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(['a']);
    });

    it('says the box adds where the press carried Ctrl', () => {
        render(<Host />);

        pullTo(0, 0, 50, 50, { ctrlKey: true });

        expect(onStart).toHaveBeenCalledWith(true);
    });

    it('says the box adds on Cmd too, which is the same gesture on a Mac', () => {
        render(<Host />);

        pullTo(0, 0, 50, 50, { metaKey: true });

        expect(onStart).toHaveBeenCalledWith(true);
    });

    it('is no box where the press started on a card', () => {
        render(<Host />);

        pointer('pointerdown', card(), 10, 10);
        pointer('pointermove', canvas(), 250, 250);
        pointer('pointerup', canvas(), 250, 250);

        expect(onStart).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(box()).toBeNull();
    });

    it('is no box where the press started inside a rectangle — that pull carries its members', () => {
        render(<Host />);

        pointer('pointerdown', workflow(), 10, 10);
        pointer('pointermove', canvas(), 250, 250);
        pointer('pointerup', canvas(), 250, 250);

        expect(onStart).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(box()).toBeNull();
    });

    it('is no box where the press came from a portal outside the canvas', () => {
        render(<Host />);

        pointer('pointerdown', portalItem(), 10, 10);
        pointer('pointermove', portalItem(), 250, 250);
        pointer('pointerup', portalItem(), 250, 250);

        expect(onStart).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(box()).toBeNull();
    });

    it('is no box on another button — the right-click is the canvas menu’s', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 0, 0, { button: 2 });
        pointer('pointermove', canvas(), 250, 250, { button: 2 });
        pointer('pointerup', canvas(), 250, 250, { button: 2 });

        expect(onStart).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('writes nothing for a press that went nowhere — that is the click that clears', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 200, 200);
        pointer('pointerup', canvas(), 201, 201);

        expect(onStart).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(held?.justSelected()).toBe(false);
    });

    it('marks the click after a box as the box’s, not the canvas’s', () => {
        render(<Host />);

        pullTo(0, 0, 50, 50);

        expect(held?.justSelected()).toBe(true);
    });

    it('measures the gesture through the zoom the board is read at', () => {
        render(<Host zoom={0.5} />);

        pointer('pointerdown', canvas(), 0, 0);
        pointer('pointermove', canvas(), 60, 60);

        expect(box()?.dataset).toMatchObject({ w: '120', h: '120' });
        expect(onChange).toHaveBeenLastCalledWith(['a']);
    });

    it('counts the canvas scrolling under the gesture', () => {
        render(<Host />);
        canvas().scrollLeft = 100;

        pointer('pointerdown', canvas(), 100, 50);
        canvas().scrollLeft = 0;
        pointer('pointermove', canvas(), 10, 60);
        pointer('pointerup', canvas(), 10, 60);

        expect(onChange).toHaveBeenLastCalledWith(['a']);
    });

    it('puts the set back on Escape, and the gesture ends there', () => {
        render(<Host />);

        pointer('pointerdown', canvas(), 0, 0);
        pointer('pointermove', canvas(), 250, 150);
        expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);

        fireEvent.keyDown(canvas(), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(box()).toBeNull();

        pointer('pointermove', canvas(), 10, 10);
        pointer('pointerup', canvas(), 10, 10);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
