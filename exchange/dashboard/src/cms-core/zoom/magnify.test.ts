import { describe, it, expect, afterEach } from 'vitest';
import { magnify, FLOATING_ATTR, PLACEHOLDER_ATTR } from './magnify';
import { VIEWPORT_MARGIN, type Box } from './zoomPlacement';

/** jsdom's window, which is what `magnify` reads the available area from. */
const VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

const px = (value: string, fallback: number) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const rect = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}),
}) as DOMRect;

/**
 * A stand-in for layout, because jsdom measures nothing.
 *
 * It states the two rules a browser would apply and that `magnify` is written against: a `zoom`ed
 * element is drawn `factor` times the size its CSS asks for, and the lengths set on it — `left` and
 * `top` among them — may or may not be scaled by that same factor. `scaledOffsets` is that second
 * rule, and running the suite both ways is the point: the placement measures the browser's answer
 * instead of assuming one.
 *
 * `ambient` is a zoom the flow itself is under — the markdown preview read at anything but 100% —
 * which multiplies every length in it, the element's own factor included.
 */
const fakeLayout = (slot: Box, scaledOffsets: boolean, ambient = 1) => function (this: Element): DOMRect {
    const element = this as HTMLElement;
    if (element.hasAttribute(PLACEHOLDER_ATTR)) {
        // The placeholder is in the flow, in the slot the element left, and its lengths are that
        // flow's own.
        return rect(slot.left, slot.top, px(element.style.width, 0) * ambient, px(element.style.height, 0) * ambient);
    }
    if (element.style.position !== 'fixed') return rect(slot.left, slot.top, slot.width, slot.height);
    // The factor is read from the attribute rather than from `style.zoom`: jsdom drops inline
    // properties it does not implement, and `zoom` is one of them.
    const zoom = px(element.getAttribute(FLOATING_ATTR) ?? '', 1) * ambient;
    const unit = scaledOffsets ? zoom : 1;
    return rect(
        px(element.style.left, 0) * unit,
        px(element.style.top, 0) * unit,
        Math.min(px(element.style.width, slot.width), px(element.style.maxWidth, Infinity)) * zoom,
        Math.min(slot.height, px(element.style.maxHeight, Infinity)) * zoom,
    );
};

const original = Element.prototype.getBoundingClientRect;
afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
    document.body.innerHTML = '';
});

/** A target in a flow of its own, with the slot it occupies declared for the fake layout. */
const target = (slot: Box, scaledOffsets = true, ambient = 1) => {
    const parent = document.createElement('div');
    const before = document.createElement('p');
    const element = document.createElement('div');
    const after = document.createElement('p');
    parent.append(before, element, after);
    document.body.append(parent);
    element.style.cssText = 'color:red';
    // jsdom lays nothing out, so the element states the one thing an ambient zoom is read from
    // where the browser does not state it itself: its box in its own units, which the box on
    // screen is that zoom times.
    Object.defineProperty(element, 'offsetWidth', { value: slot.width / ambient, configurable: true });
    Element.prototype.getBoundingClientRect = fakeLayout(slot, scaledOffsets, ambient);
    return { parent, element, before, after };
};

describe('magnify', () => {
    const SLOT = { left: 120, top: 300, width: 200, height: 100 };

    it('holds the space it leaves so that nothing behind it moves', () => {
        const { parent, element } = target(SLOT);
        magnify(element, 1.5);

        const placeholder = parent.querySelector(`[${PLACEHOLDER_ATTR}]`) as HTMLElement;
        expect(placeholder).not.toBeNull();
        // Where the element was, at the size it was, and still the second child of the flow.
        expect(placeholder.nextSibling).toBe(element);
        expect(placeholder.style.width).toBe('200px');
        expect(placeholder.style.height).toBe('100px');
    });

    it('floats the element at the asked-for factor, keeping the width it had', () => {
        const { element } = target(SLOT);
        magnify(element, 1.5);

        expect(element.getAttribute(FLOATING_ATTR)).toBe('1.5');
        expect(element.style.position).toBe('fixed');
        // The width is pinned in the element's own units, which `zoom` then multiplies: the content
        // keeps the line breaks it had and is simply drawn larger.
        expect(element.style.width).toBe('200px');
    });

    it.each([true, false])('lands where the element was, whether or not zoom scales offsets (%s)', scaled => {
        const { element } = target(SLOT, scaled);
        magnify(element, 1.5);

        const drawn = element.getBoundingClientRect();
        expect(drawn.left).toBeCloseTo(SLOT.left);
        expect(drawn.top).toBeCloseTo(SLOT.top);
        expect(drawn.width).toBeCloseTo(SLOT.width * 1.5);
    });

    it('pushes an element near the edge back inside the window', () => {
        const nearEdge = { left: VIEWPORT.width - 220, top: VIEWPORT.height - 120, width: 200, height: 100 };
        const { element } = target(nearEdge);
        magnify(element, 1.5);

        const drawn = element.getBoundingClientRect();
        expect(drawn.right).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN);
        expect(drawn.bottom).toBeLessThanOrEqual(VIEWPORT.height - VIEWPORT_MARGIN);
        expect(drawn.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(drawn.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    });

    it('caps what is larger than the window and lets it scroll inside itself', () => {
        const huge = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height * 2 };
        const { element } = target(huge);
        magnify(element, 1.5);

        const drawn = element.getBoundingClientRect();
        expect(drawn.width).toBeLessThanOrEqual(VIEWPORT.width - 2 * VIEWPORT_MARGIN);
        expect(drawn.height).toBeLessThanOrEqual(VIEWPORT.height - 2 * VIEWPORT_MARGIN);
        expect(element.style.overflow).toBe('auto');
    });

    it('reads the flow it is in rather than assuming one, so a zoomed pane holds it too', () => {
        // A diagram in the markdown preview, read at 150%: what is set on the element is worth 1.5
        // screen pixels before its own factor, and `factor` alone would be a guess of 1.
        const wide = { left: 40, top: 60, width: VIEWPORT.width * 0.8, height: 120 };
        const { parent, element } = target(wide, true, 1.5);
        magnify(element, 1.5);

        // The window is still the window, whatever the pane it was magnified out of is set to.
        const drawn = element.getBoundingClientRect();
        expect(drawn.width).toBeLessThanOrEqual(VIEWPORT.width - 2 * VIEWPORT_MARGIN);
        expect(drawn.height).toBeLessThanOrEqual(VIEWPORT.height - 2 * VIEWPORT_MARGIN);
        // And the space held open behind it is the space it took, not that space zoomed again —
        // which is what would push the rest of the document down while it floats.
        const placeholder = (parent.querySelector(`[${PLACEHOLDER_ATTR}]`) as HTMLElement).getBoundingClientRect();
        expect(placeholder.width).toBeCloseTo(wide.width);
        expect(placeholder.height).toBeCloseTo(wide.height);
    });

    it('follows the slot when the page behind it scrolls', () => {
        const slot = { ...SLOT };
        const { parent, element } = target(slot);
        Element.prototype.getBoundingClientRect = fakeLayout(slot, true);
        const magnified = magnify(element, 1.5);

        slot.top -= 150; // the transcript scrolled under it
        magnified.reposition();

        expect(element.getBoundingClientRect().top).toBeCloseTo(SLOT.top - 150);
        expect(parent.querySelector(`[${PLACEHOLDER_ATTR}]`)).not.toBeNull();
    });

    it('takes the surface it was read against, so it hides the page rather than blending into it', () => {
        const { parent, element } = target(SLOT);
        // A chat bubble: the colour and the contrast are the parent's, the text block owns neither.
        parent.style.backgroundColor = 'rgb(22, 119, 255)';
        magnify(element, 1.5);

        expect(element.style.backgroundColor).toBe('rgb(22, 119, 255)');
    });

    it('leaves a background it already has alone', () => {
        const { element } = target(SLOT);
        element.style.backgroundColor = 'rgb(1, 2, 3)';
        magnify(element, 1.5);

        expect(element.style.backgroundColor).toBe('rgb(1, 2, 3)');
    });

    it('puts everything back exactly as it was found', () => {
        const { parent, element } = target(SLOT);
        const magnified = magnify(element, 1.5);
        magnified.release();

        expect(element.style.cssText).toBe('color: red;');
        expect(element.hasAttribute(FLOATING_ATTR)).toBe(false);
        expect(parent.querySelector(`[${PLACEHOLDER_ATTR}]`)).toBeNull();
        expect(parent.children.length).toBe(3);
    });

    it('updates zoom without replacing the placeholder or resetting the scroll position', () => {
        const { parent, element } = target(SLOT);
        const magnified = magnify(element, 1.25);
        const placeholder = parent.querySelector(`[${PLACEHOLDER_ATTR}]`);
        element.scrollLeft = 35;
        element.scrollTop = 60;

        magnified.setFactor(2);

        expect(element.getAttribute(FLOATING_ATTR)).toBe('2');
        expect(parent.querySelector(`[${PLACEHOLDER_ATTR}]`)).toBe(placeholder);
        expect(element.scrollLeft).toBe(35);
        expect(element.scrollTop).toBe(60);
        expect(element.getBoundingClientRect().width).toBeCloseTo(SLOT.width * 2);
        magnified.release();
    });

    it('restores child sizing without losing unrelated style updates', () => {
        const { element } = target(SLOT);
        const content = document.createElement('div');
        content.style.cssText = 'display:block;width:180px;max-width:100% !important';
        element.append(content);
        const magnified = magnify(element, 1.5);
        content.style.color = 'blue';
        magnified.release();

        expect(content.style.width).toBe('180px');
        expect(content.style.minWidth).toBe('');
        expect(content.style.maxWidth).toBe('100%');
        expect(content.style.getPropertyPriority('max-width')).toBe('important');
        expect(content.style.flexShrink).toBe('');
        expect(content.style.color).toBe('blue');
    });
});
