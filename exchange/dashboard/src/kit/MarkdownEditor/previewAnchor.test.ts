import { describe, it, expect, afterEach } from 'vitest';
import { anchorAtTop, restoreAnchor } from './previewAnchor';

/**
 * What the anchor is for is the one thing a fraction of the content cannot do: survive the
 * document being laid out again. The blocks here change height between the two measurements, which
 * is what zooming does to a rendered document — bigger text, different wrapping, every offset in
 * the pane moved.
 */

const PANE_TOP = 100;
const PANE_HEIGHT = 400;

const rect = (top: number, bottom: number) => ({
    top, bottom, left: 0, right: 0, x: 0, y: top, width: 0, height: bottom - top, toJSON: () => ({}),
}) as DOMRect;

/** A pane of stacked blocks, laid out by a stand-in for the browser: block i starts at i × height. */
const pane = (count: number, height = 40) => {
    const element = document.createElement('div');
    const container = document.createElement('div');
    container.className = 'configured-markdown-container';
    // The shape the renderer draws: the copy-HTML button, then the document in a box of its own.
    container.append(document.createElement('button'));
    const rendered = container.appendChild(document.createElement('div'));
    element.append(container);
    document.body.append(element);
    const blocks = Array.from({ length: count }, () => rendered.appendChild(document.createElement('p')));

    const state = { scrollTop: 0, height };
    Object.defineProperty(element, 'scrollTop', {
        get: () => state.scrollTop,
        set: (value: number) => { state.scrollTop = value; },
        configurable: true,
    });
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this === element) return rect(PANE_TOP, PANE_TOP + PANE_HEIGHT);
        const index = blocks.indexOf(this as HTMLParagraphElement);
        if (index < 0) return rect(0, 0);
        const top = PANE_TOP - state.scrollTop + index * state.height;
        return rect(top, top + state.height);
    };
    return { element, blocks, state };
};

const original = Element.prototype.getBoundingClientRect;
afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
    document.body.innerHTML = '';
});

describe('the preview anchor', () => {
    it('names the block at the top of the pane, and how far past the edge it has gone', () => {
        const { element, blocks, state } = pane(20);
        state.scrollTop = 100; // two blocks and half of a third

        const anchor = anchorAtTop(element)!;

        expect(anchor.element).toBe(blocks[2]);
        expect(anchor.offset).toBe(-20);
    });

    it('puts that block back where it was, whatever the content did in between', () => {
        const { element, state } = pane(20);
        state.scrollTop = 100;
        const anchor = anchorAtTop(element)!;

        state.height = 60; // the document, laid out again at another size

        restoreAnchor(element, anchor);

        // The third block is back 20 pixels above the edge, where the reader left it — and not at
        // the 100 pixels it was scrolled to, which is now the middle of the second block.
        expect(element.scrollTop).toBe(140);
    });

    it('leaves the pane where it is when the block it held is gone', () => {
        const { element, state } = pane(20);
        state.scrollTop = 100;
        const anchor = anchorAtTop(element)!;
        anchor.element.remove();

        restoreAnchor(element, anchor);

        expect(element.scrollTop).toBe(100);
    });

    it('anchors nothing in a preview that has rendered nothing', () => {
        const { element } = pane(0);

        expect(anchorAtTop(element)).toBeNull();
    });
});
