import { describe, it, expect } from 'vitest';
import { placeInViewport, resizeInViewport, zoomBounds, VIEWPORT_MARGIN, type ResizeEdge } from './zoomPlacement';

const AREA = { left: 0, top: 0, width: 1000, height: 800 };

describe('zoomBounds', () => {
    it('leaves the margin on each side', () => {
        expect(zoomBounds(AREA)).toEqual({
            margin: VIEWPORT_MARGIN,
            maxWidth: 1000 - 2 * VIEWPORT_MARGIN,
            maxHeight: 800 - 2 * VIEWPORT_MARGIN,
        });
    });

    it('gives up the margin before it gives up the area', () => {
        // A pane 20px tall would have nothing left under an 8px margin each way.
        const { margin, maxHeight } = zoomBounds({ left: 0, top: 0, width: 1000, height: 20 });
        expect(margin).toBe(5);
        expect(maxHeight).toBe(10);
    });
});

describe('placeInViewport', () => {
    const size = { width: 300, height: 200 };

    it('leaves the element where the reader was already looking', () => {
        expect(placeInViewport({ left: 120, top: 240 }, size, AREA)).toEqual({ left: 120, top: 240 });
    });

    it('pushes back in what would run off the right and the bottom', () => {
        expect(placeInViewport({ left: 900, top: 700 }, size, AREA)).toEqual({
            left: 1000 - VIEWPORT_MARGIN - 300,
            top: 800 - VIEWPORT_MARGIN - 200,
        });
    });

    it('pushes back in what would run off the top and the left', () => {
        expect(placeInViewport({ left: -40, top: -10 }, size, AREA))
            .toEqual({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN });
    });

    it('shows the start of what is too large to fit whole', () => {
        // Nothing can place a 900px-tall box inside 800px: what it must not do is push the top of it
        // off the screen to bring the bottom in.
        expect(placeInViewport({ left: 500, top: 500 }, { width: 300, height: 900 }, AREA).top)
            .toBe(VIEWPORT_MARGIN);
    });

    it('places against the area it is given, not against the window', () => {
        // The banner's band is not part of the area, so nothing is ever laid over the slider.
        const belowBanner = { left: 0, top: 40, width: 1000, height: 760 };
        expect(placeInViewport({ left: 10, top: 0 }, size, belowBanner).top).toBe(40 + VIEWPORT_MARGIN);
    });
});

describe('resizeInViewport', () => {
    const box = { left: 200, top: 150, width: 300, height: 200 };

    it.each<[ResizeEdge, typeof box]>([
        ['left', { left: 220, top: 150, width: 280, height: 200 }],
        ['right', { left: 200, top: 150, width: 320, height: 200 }],
        ['top', { left: 200, top: 180, width: 300, height: 170 }],
        ['bottom', { left: 200, top: 150, width: 300, height: 230 }],
        ['top-left', { left: 220, top: 180, width: 280, height: 170 }],
        ['top-right', { left: 200, top: 180, width: 320, height: 170 }],
        ['bottom-left', { left: 220, top: 150, width: 280, height: 230 }],
        ['bottom-right', { left: 200, top: 150, width: 320, height: 230 }],
    ])('resizes from %s while keeping the opposite borders still', (edge, expected) => {
        expect(resizeInViewport(box, edge, { left: 20, top: 30 }, AREA)).toEqual(expected);
    });

    it('keeps a drag inside the viewport and below the controls', () => {
        const area = { left: 0, top: 40, width: 1000, height: 760 };
        expect(resizeInViewport(box, 'top-left', { left: -1000, top: -1000 }, area))
            .toEqual({ left: 8, top: 48, width: 492, height: 302 });
        expect(resizeInViewport(box, 'bottom-right', { left: 1000, top: 1000 }, area))
            .toEqual({ left: 200, top: 150, width: 792, height: 642 });
    });

    it('keeps a usable minimum size when dragged past the opposite border', () => {
        expect(resizeInViewport(box, 'top-left', { left: 1000, top: 1000 }, AREA))
            .toEqual({ left: 452, top: 302, width: 48, height: 48 });
        expect(resizeInViewport(box, 'bottom-right', { left: -1000, top: -1000 }, AREA))
            .toEqual({ left: 200, top: 150, width: 48, height: 48 });
    });
});
