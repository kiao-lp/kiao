import React, { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SplitPart, SplitRow } from './SplitRow';

// Gesture wiring only; arithmetic is covered in splitModel tests.

/** jsdom lays nothing out, and a drag is read off the widths on screen. */
const sized = (element: Element, width: number) => {
    element.getBoundingClientRect = () => ({
        width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
};

const part = (name: string, extra: Partial<SplitPart> = {}): SplitPart =>
    ({ name, children: <div data-testid={`content-${name}`} />, ...extra });

const partBox = (container: HTMLElement, name: string): HTMLElement =>
    container.querySelector<HTMLElement>(`[data-split-part="${name}"]`)!;

const handleBefore = (container: HTMLElement, name: string): HTMLElement =>
    container.querySelector<HTMLElement>(`[data-testid="split-resize-${name}"]`)!;

/**
 * MouseEvent stands in for PointerEvent; jsdom drops clientX otherwise.
 */
const pointer = (type: string, target: Element, clientX: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

/** The parts of the row as they would be laid out, evenly, across a row `width` wide. */
const layOut = (container: HTMLElement, width: number) => {
    const parts = [...container.querySelectorAll('[data-split-part]')]
        .filter(box => !box.classList.contains('cms-split-part-collapsed'));
    parts.forEach(box => sized(box, width / parts.length));
};

/**
 * Drags via the handle; pointer capture keeps moves on the handle.
 */
const drag = (container: HTMLElement, name: string, by: number, width = 1000) => {
    const handle = handleBefore(container, name);
    layOut(container, width);
    pointer('pointerdown', handle, 0);
    pointer('pointermove', handle, by);
    pointer('pointerup', handle, by);
};

describe('a divided centre', () => {
    it('shares the row out evenly until a handle is dragged', () => {
        const { container } = render(
            <SplitRow id="test" parts={[part('source'), part('preview')]} />,
        );
        expect(partBox(container, 'source').style.flexGrow).toBe('1');
        expect(partBox(container, 'preview').style.flexGrow).toBe('1');
    });

    it('draws one handle between each two parts, and none at the edges', () => {
        const { container } = render(
            <SplitRow id="test" parts={[part('host'), part('mindmap'), part('graph')]} />,
        );
        expect(container.querySelectorAll('.cms-split-handle')).toHaveLength(2);
        expect(container.firstElementChild?.firstElementChild)
            .toHaveAttribute('data-split-part', 'host');
    });

    it('moves width from one part of the pair to the other, and leaves the third alone', () => {
        const { container } = render(
            <SplitRow id="test" parts={[part('host'), part('mindmap'), part('graph')]} />,
        );
        // Middle handle moves 100px within its pair.
        drag(container, 'graph', 100);
        expect(Number(partBox(container, 'mindmap').style.flexGrow)).toBeCloseTo(1.3, 1);
        expect(Number(partBox(container, 'graph').style.flexGrow)).toBeCloseTo(0.7, 1);
        expect(partBox(container, 'host').style.flexGrow).toBe('1');
    });

    it('gives no handle to a part that has given its width up', () => {
        const { container } = render(
            <SplitRow id="test" parts={[part('host', { collapsed: true }), part('mindmap')]} />,
        );
        // Nothing to drag: the host is not on screen, and the pane is the whole row.
        expect(container.querySelectorAll('.cms-split-handle')).toHaveLength(0);
        expect(partBox(container, 'host')).toHaveClass('cms-split-part-collapsed');
        expect(partBox(container, 'host').style.flexGrow).toBe('');
        // It stays mounted: what it holds may still be saving.
        expect(container.querySelector('[data-testid="content-host"]')).toBeInTheDocument();
    });

    it('fills the row with the part left alone on it, whatever its remembered share is', () => {
        const { container, rerender } = render(
            <SplitRow id="test" parts={[part('source'), part('preview')]} />,
        );
        // Shrink the preview below half: source 1.2, preview 0.8.
        drag(container, 'preview', 100);
        expect(Number(partBox(container, 'preview').style.flexGrow)).toBeCloseTo(0.8, 1);
        // A lone part fills the row regardless of its pair share.
        rerender(
            <SplitRow id="test" parts={[part('source', { collapsed: true }), part('preview')]} />,
        );
        expect(partBox(container, 'preview').style.flexGrow).toBe('1');
    });

    it('drags across a part that has given its width up', () => {
        const { container } = render(
            <SplitRow
                id="test"
                parts={[part('host'), part('mindmap', { collapsed: true }), part('graph')]}
            />,
        );
        drag(container, 'graph', 100);
        expect(Number(partBox(container, 'host').style.flexGrow)).toBeCloseTo(1.2, 1);
        expect(Number(partBox(container, 'graph').style.flexGrow)).toBeCloseTo(0.8, 1);
    });

    it('ignores a second pointer put down elsewhere while a handle is held', () => {
        const { container } = render(
            <SplitRow id="test" parts={[part('source'), part('preview')]} />,
        );
        const handle = handleBefore(container, 'preview');
        layOut(container, 1000);
        pointer('pointerdown', handle, 0);
        // A finger landing on the screen somewhere else moves its own way; the divider stays put.
        pointer('pointermove', handle, 300, 2);
        expect(partBox(container, 'source').style.flexGrow).toBe('1');
        pointer('pointermove', handle, 100);
        expect(Number(partBox(container, 'source').style.flexGrow)).toBeCloseTo(1.2, 1);
    });

    it('is otherwise the box the caller asked for', () => {
        const pane = createRef<HTMLDivElement>();
        const { container } = render(
            <SplitRow id="test" parts={[
                part('host'),
                part('mindmap', {
                    ref: pane,
                    className: 'cms-side-document',
                    style: { overflow: 'auto' },
                    'data-side-document': 'mindmap',
                }),
            ]} />,
        );
        const box = partBox(container, 'mindmap');
        expect(pane.current).toBe(box);
        expect(box).toHaveClass('cms-split-part', 'cms-side-document');
        expect(box).toHaveAttribute('data-side-document', 'mindmap');
        // The width the row computed is added to the style rather than replacing it.
        expect(box.style.overflow).toBe('auto');
        expect(box.style.flexGrow).toBe('1');
    });
});
