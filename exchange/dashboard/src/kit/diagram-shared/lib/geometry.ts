/**
 * Shared geometry utilities for SVG diagram rendering.
 */

/**
 * Compute the intersection point of a line segment (p1→p2)
 * with an axis-aligned rectangle [rx, ry, rw, rh].
 *
 * Uses the Liang–Barsky clipping algorithm.
 * If the segment does not intersect, returns p2 unchanged.
 */
export function getRectIntersection(
    p1: [number, number],
    p2: [number, number],
    rect: [number, number, number, number],
): [number, number] {
    const [rx, ry, rw, rh] = rect;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];

    const p = [-dx, dx, -dy, dy];
    const q = [p1[0] - rx, rx + rw - p1[0], p1[1] - ry, ry + rh - p1[1]];

    let u1 = 0;
    let u2 = 1;

    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return p2;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > u2) return p2;
                if (t > u1) u1 = t;
            } else {
                if (t < u1) return p2;
                if (t < u2) u2 = t;
            }
        }
    }

    return [p1[0] + u1 * dx, p1[1] + u1 * dy];
}

/**
 * Convert screen-space mouse coordinates to SVG user-space.
 */
export function clientToSvg(
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
): { x: number; y: number } {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const inv = ctm.inverse();
    return {
        x: clientX * inv.a + clientY * inv.c + inv.e,
        y: clientX * inv.b + clientY * inv.d + inv.f,
    };
}
