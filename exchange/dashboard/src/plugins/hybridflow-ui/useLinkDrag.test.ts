import { describe, it, expect, afterEach } from 'vitest';
import { FLOW_NODE_ID_ATTRIBUTE } from './boardDom';
import { flowNodeUnder } from './useLinkDrag';

/**
 * The chain's target, read through the relation strokes: a stroke takes the pointer where the
 * empty canvas passes it through, so the one answer `elementFromPoint` gives is the line the
 * chain happens to cross — and the stack it stands in still names the card under the pointer.
 */
describe('flowNodeUnder', () => {
    const realElementsFromPoint = document.elementsFromPoint;
    const realElementFromPoint = document.elementFromPoint;
    afterEach(() => {
        Object.defineProperty(document, 'elementsFromPoint', {
            value: realElementsFromPoint, configurable: true, writable: true,
        });
        Object.defineProperty(document, 'elementFromPoint', {
            value: realElementFromPoint, configurable: true, writable: true,
        });
    });

    const stackAs = (...elements: Element[]) => {
        Object.defineProperty(document, 'elementsFromPoint', {
            value: () => elements, configurable: true, writable: true,
        });
    };

    /** A stroke, the way the relation layer draws one: an SVG line naming no card. */
    const stroke = (): Element =>
        document.createElementNS('http://www.w3.org/2000/svg', 'line');

    /** An element nested inside a card, the way a knob's label sits inside it. */
    const cardInner = (id: string): Element => {
        const card = document.createElement('div');
        card.setAttribute(FLOW_NODE_ID_ATTRIBUTE, id);
        const inner = document.createElement('span');
        card.appendChild(inner);
        return inner;
    };

    it('reads the card through the stroke standing over it', () => {
        stackAs(stroke(), cardInner('flow-node-1'), document.documentElement);

        expect(flowNodeUnder(10, 10)).toBe('flow-node-1');
    });

    it('answers null where the stack names no card', () => {
        stackAs(stroke(), document.documentElement);

        expect(flowNodeUnder(10, 10)).toBeNull();
    });

    // Where the stack is missing, the single answer is all there is.
    it('falls back to the single answer without elementsFromPoint', () => {
        Object.defineProperty(document, 'elementsFromPoint', {
            value: undefined, configurable: true, writable: true,
        });
        const inner = cardInner('flow-node-2');
        Object.defineProperty(document, 'elementFromPoint', {
            value: () => inner, configurable: true, writable: true,
        });

        expect(flowNodeUnder(5, 5)).toBe('flow-node-2');
    });
});
