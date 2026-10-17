import { describe, it, expect } from 'vitest';

import {
    Quadratic, controlThrough, quadraticAt, quadraticBandOutlinePath, quadraticBandPath, quadraticPath,
    splitQuadratic, startFacingDeg, trimQuadraticStart
} from './quadratic';

/** The corners of a drawn band, which is a polyline and nothing else. */
const cornersOf = (path: string): number[][] => {
    const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const corners: number[][] = [];
    for (let at = 0; at < numbers.length; at += 2) corners.push([numbers[at], numbers[at + 1]]);
    return corners;
};

describe('controlThrough', () => {
    // What the whole drawing rests on: the curve is quadratic so that saying where it passes
    // says the whole of it, and nothing has to be searched for.
    it('gives the control point of a curve that passes through the point at its middle', () => {
        const control = controlThrough([0, 0], [100, 0], [50, -40]);

        expect(quadraticAt([[0, 0], control, [100, 0]], 0.5)).toEqual([50, -40]);
    });

    it('lays the curve on the straight line when the point is already halfway along it', () => {
        expect(controlThrough([0, 0], [100, 40], [50, 20])).toEqual([50, 20]);
    });
});

describe('splitQuadratic', () => {
    const curve: Quadratic = [[0, 0], [50, -100], [100, 0]];

    it('cuts a curve into two that meet where it was cut', () => {
        const [left, right] = splitQuadratic(curve, 0.5);

        expect(left[2]).toEqual(quadraticAt(curve, 0.5));
        expect(right[0]).toEqual(quadraticAt(curve, 0.5));
    });

    // Each half has to draw the piece it came from, or the two would not read as one curve.
    it('leaves each half running where the whole ran', () => {
        const [left, right] = splitQuadratic(curve, 0.5);

        expect(quadraticAt(left, 0.5)).toEqual(quadraticAt(curve, 0.25));
        expect(quadraticAt(right, 0.5)).toEqual(quadraticAt(curve, 0.75));
    });
});

describe('trimQuadraticStart', () => {
    it('takes the asked-for distance off the start of a straight curve, and leaves the end', () => {
        const trimmed = trimQuadraticStart([[0, 0], [50, 0], [100, 0]], 24);

        expect(trimmed[0][0]).toBeCloseTo(24, 3);
        expect(trimmed[0][1]).toBeCloseTo(0, 3);
        expect(trimmed[2]).toEqual([100, 0]);
    });

    // The distance is one across the plane, which is what a decoration takes up — not one along
    // the curve, which would leave the ink short of a decoration on a hard bend.
    it('takes the asked-for distance off the start of a bent one', () => {
        const trimmed = trimQuadraticStart([[0, 0], [50, -100], [100, 0]], 24);

        expect(Math.hypot(trimmed[0][0], trimmed[0][1])).toBeCloseTo(24, 3);
    });

    // A relation shorter than the decoration it carries: there is no ink left, and none is drawn.
    it('leaves nothing of a curve shorter than the distance asked for', () => {
        const trimmed = trimQuadraticStart([[0, 0], [5, 0], [10, 0]], 24);

        expect(trimmed[0]).toEqual([10, 0]);
    });

    it('leaves a curve that goes nowhere alone', () => {
        const curve: Quadratic = [[7, 7], [7, 7], [7, 7]];

        expect(trimQuadraticStart(curve, 24)).toEqual(curve);
    });
});

describe('startFacingDeg', () => {
    // Where a decoration points: out of the note, against the way the curve runs from it.
    it('faces away from the way the curve leaves', () => {
        expect(startFacingDeg([[0, 0], [50, 0], [100, 0]])).toBe(180);
        expect(startFacingDeg([[0, 0], [0, 50], [0, 100]])).toBe(-90);
    });

    it('falls back on the far end when the curve starts where its control point is', () => {
        expect(startFacingDeg([[0, 0], [0, 0], [100, 0]])).toBe(180);
    });
});

describe('quadraticPath', () => {
    it('writes the curve as an SVG path, rounded short of a pixel', () => {
        expect(quadraticPath([[0.001, 10], [50, -40], [100, 10]])).toBe('M 0 10 Q 50 -40 100 10');
    });
});

describe('quadraticBandPath', () => {
    const straight: Quadratic = [[0, 0], [50, 0], [100, 0]];

    it('runs a band of one width along a straight curve, cut square at both ends', () => {
        const corners = cornersOf(quadraticBandPath(straight, 10, 10));

        expect(corners.every(([, y]) => Math.abs(y) === 5)).toBe(true);
        expect(corners[0]).toEqual([0, 5]);
        expect(corners[corners.length - 1]).toEqual([0, -5]);
    });

    // The triangle: a width of nought closes the band, so both its sides start at the one point.
    it('closes the band to a point at an end of no width', () => {
        const corners = cornersOf(quadraticBandPath(straight, 0, 20));

        expect(corners[0]).toEqual([0, 0]);
        expect(corners[corners.length - 1]).toEqual([0, 0]);
        expect(corners.find(([x]) => x === 100)).toEqual([100, 10]);
    });

    // What the whole thing is for: the shape follows the bend rather than lying straight across
    // it. The curve tops out fifty above its ends, so the outer edge of a ten-wide band tops out
    // five above that — which a rectangle drawn between the same two points never would.
    it('bends the band along the curve', () => {
        const corners = cornersOf(quadraticBandPath([[0, 0], [50, -100], [100, 0]], 10, 10));

        expect(Math.min(...corners.map(([, y]) => y))).toBeCloseTo(-55, 1);
    });

    it('leaves both edges the same length, so the band has no seam of its own', () => {
        const corners = cornersOf(quadraticBandPath([[0, 0], [50, -100], [100, 0]], 4, 30));

        expect(corners.length % 2).toBe(0);
    });
});

describe('quadraticBandOutlinePath', () => {
    const straight: Quadratic = [[0, 0], [50, 0], [100, 0]];

    // The empty rectangle: the same two edges, with the far end left open so that the two halves
    // of a relation join there instead of each drawing a line across the middle of the body.
    it('draws the band as an open outline, shut square only where the curve starts', () => {
        const outline = quadraticBandOutlinePath(straight, 10, 10);
        const corners = cornersOf(outline);

        expect(outline.endsWith('Z')).toBe(false);
        expect(corners[0]).toEqual([100, 5]);
        expect(corners[corners.length - 1]).toEqual([100, -5]);
        expect(corners.filter(([x]) => x === 0)).toEqual([[0, 5], [0, -5]]);
    });

    it('runs along the very edges the filled band is cut from', () => {
        const filled = cornersOf(quadraticBandPath(straight, 4, 30));
        const outlined = cornersOf(quadraticBandOutlinePath(straight, 4, 30));

        expect(outlined).toHaveLength(filled.length);
        expect([...outlined].sort()).toEqual([...filled].sort());
    });
});
