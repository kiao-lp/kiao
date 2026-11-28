import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResizeEdge, useCardResize } from './useCardResize';

/** Dragging a selected card's edge changes its size, and its position only when the edge faces left or up. */

const onResize = vi.fn();

const Host: React.FC<{ zoom?: number; height?: number | undefined }> = ({ zoom = 1, height }) => {
    const resize = useCardResize(onResize, zoom);
    const target = {
        id: 'card',
        spot: { x: 100, y: 100 },
        size: height === undefined ? { w: 200 } : { w: 200, h: height },
        height: 120,
        minWidth: 120,
        minHeight: 60,
    };
    const edge = (side: ResizeEdge) => (
        <span data-testid={`edge-${side}`} {...resize.resizeProps(target, side)} />
    );
    return <>{edge('top')}{edge('right')}{edge('bottom')}{edge('left')}</>;
};

const pointer = (type: string, target: Element, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const drag = (side: ResizeEdge, fromX: number, fromY: number, toX: number, toY: number) => {
    const target = screen.getByTestId(`edge-${side}`);
    pointer('pointerdown', target, fromX, fromY);
    pointer('pointermove', target, toX, toY);
    pointer('pointerup', target, toX, toY);
};

describe('useCardResize — dragging an edge', () => {
    it('widens from the right edge without moving the card', () => {
        onResize.mockClear();
        render(<Host />);

        drag('right', 200, 100, 250, 100);

        expect(onResize).toHaveBeenCalledWith('card', { w: 250 }, { x: 100, y: 100 });
    });

    it('widens from the left edge, keeping its right edge where it was', () => {
        onResize.mockClear();
        render(<Host />);

        drag('left', 200, 100, 150, 100);

        expect(onResize).toHaveBeenCalledWith('card', { w: 250 }, { x: 50, y: 100 });
    });

    it('raises the height from the bottom edge without moving the card', () => {
        onResize.mockClear();
        render(<Host />);

        drag('bottom', 200, 100, 200, 160);

        expect(onResize).toHaveBeenCalledWith('card', { w: 200, h: 180 }, { x: 100, y: 100 });
    });

    it('raises the height from the top edge, keeping its bottom edge where it was', () => {
        onResize.mockClear();
        render(<Host />);

        drag('top', 200, 100, 200, 40);

        expect(onResize).toHaveBeenCalledWith('card', { w: 200, h: 180 }, { x: 100, y: 40 });
    });

    it('stops at the minimum width and height', () => {
        onResize.mockClear();
        render(<Host />);

        drag('right', 500, 100, 0, 100);
        expect(onResize).toHaveBeenLastCalledWith('card', { w: 120 }, { x: 100, y: 100 });

        drag('top', 200, 100, 200, 500);
        expect(onResize).toHaveBeenLastCalledWith('card', { w: 200, h: 60 }, { x: 100, y: 160 });
    });

    it('keeps a height somebody already set when only the width changes', () => {
        onResize.mockClear();
        render(<Host height={180} />);

        drag('right', 200, 100, 220, 100);

        expect(onResize).toHaveBeenCalledWith('card', { w: 220, h: 180 }, { x: 100, y: 100 });
    });

    it('measures the gesture through the zoom the board is read at', () => {
        onResize.mockClear();
        render(<Host zoom={2} />);

        drag('right', 200, 100, 300, 100);

        expect(onResize).toHaveBeenCalledWith('card', { w: 250 }, { x: 100, y: 100 });
    });

    it('writes nothing for a press that went nowhere', () => {
        onResize.mockClear();
        render(<Host />);

        drag('right', 200, 100, 200, 100);
        drag('bottom', 200, 100, 200, 100);

        expect(onResize).not.toHaveBeenCalled();
    });
});
