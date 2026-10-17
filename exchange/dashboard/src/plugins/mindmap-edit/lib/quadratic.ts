/**
 * The quadratic Bézier a relation is drawn as, and the little that is ever done to one.
 *
 * A relation is one curve from note to note through the centre its author put it at. Quadratic
 * because that is the family with exactly one point to spend on saying where it passes: the
 * control point follows from the two ends and the centre, and no choice is left over to make.
 */

export type Point = number[];

/** Start, control, end. */
export type Quadratic = [Point, Point, Point];

/** Short of a pixel is short enough for anything drawn, and keeps the drawing readable. */
export const round = (n: number) => Math.round(n * 100) / 100;

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The control point of the curve that runs from `a` to `b` through `through` at its middle. */
export const controlThrough = (a: Point, b: Point, through: Point): Point =>
    [2 * through[0] - (a[0] + b[0]) / 2, 2 * through[1] - (a[1] + b[1]) / 2];

/** Where the curve is at `t` — 0 at its start, 1 at its end, and its middle at a half. */
export const quadraticAt = ([p0, p1, p2]: Quadratic, t: number): Point =>
    lerp(lerp(p0, p1, t), lerp(p1, p2, t), t);

/** The two curves it is cut into at `t`, which between them draw exactly what it drew. */
export const splitQuadratic = ([p0, p1, p2]: Quadratic, t: number): [Quadratic, Quadratic] => {
    const start = lerp(p0, p1, t);
    const end = lerp(p1, p2, t);
    const at = lerp(start, end, t);
    return [[p0, start, at], [at, end, p2]];
};

/** How far the curve has got from where it started, by the time it reaches `t`. */
const awayFromStart = (curve: Quadratic, t: number): number => {
    const [x, y] = quadraticAt(curve, t);
    return Math.hypot(x - curve[0][0], y - curve[0][1]);
};

/**
 * The curve with `distance` taken off its start — where a decoration is drawn, and where the ink
 * has to stop so that a hollow one does not have the line drawn through it. The distance is a
 * distance in the plane, which is what the decoration occupies, and it is found by halving the
 * interval rather than solved for: the arc has no closed form, and a curve only ever gets further
 * from where it started, so where it passes the distance is where the halving lands.
 *
 * A curve that never gets that far is taken away altogether — a relation shorter than the
 * decoration it carries is the decoration, and there is no line left to draw.
 */
export const trimQuadraticStart = (curve: Quadratic, distance: number): Quadratic => {
    if (awayFromStart(curve, 1) <= distance) return [curve[2], curve[2], curve[2]];

    let before = 0;
    let after = 1;
    for (let halving = 0; halving < 20; halving++) {
        const middle = (before + after) / 2;
        if (awayFromStart(curve, middle) < distance) before = middle; else after = middle;
    }

    return splitQuadratic(curve, after)[1];
};

/**
 * Which way the curve's start faces, in degrees clockwise from east — away from the way it runs,
 * which is where a decoration drawn there points. A curve that starts where its control point is
 * has no direction to give but the one to its far end.
 */
export const startFacingDeg = ([p0, p1, p2]: Quadratic): number => {
    const away = p0[0] === p1[0] && p0[1] === p1[1] ? p2 : p1;
    return Math.atan2(p0[1] - away[1], p0[0] - away[0]) * 180 / Math.PI;
};

/** The curve as an SVG path. */
export const quadraticPath = ([p0, p1, p2]: Quadratic): string =>
    `M ${round(p0[0])} ${round(p0[1])} Q ${round(p1[0])} ${round(p1[1])} ${round(p2[0])} ${round(p2[1])}`;

/**
 * How finely the edge of a band is drawn. A curve offset sideways is no longer a quadratic —
 * there is no exact one to write — so each edge is walked and joined up by straight pieces, and
 * this is how many. Sixteen leaves the corners under a pixel apart on the curves a relation is.
 */
const BAND_STEPS = 16;

/** Which way is across the curve at `t`, as a unit vector. */
const acrossAt = ([p0, p1, p2]: Quadratic, t: number): Point => {
    const dx = 2 * ((1 - t) * (p1[0] - p0[0]) + t * (p2[0] - p1[0]));
    const dy = 2 * ((1 - t) * (p1[1] - p0[1]) + t * (p2[1] - p1[1]));
    const length = Math.hypot(dx, dy);
    return length > 0 ? [-dy / length, dx / length] : [0, 0];
};

/**
 * The two edges of a band running along the curve, `startWidth` wide where the curve starts and
 * `endWidth` wide where it ends — one to each side of it, both walked from the start to the end.
 * A width of nought brings the two together at that end, which is the triangle's tip.
 */
const bandEdges = (curve: Quadratic, startWidth: number, endWidth: number): [Point[], Point[]] => {
    const oneSide: Point[] = [];
    const other: Point[] = [];

    for (let step = 0; step <= BAND_STEPS; step++) {
        const t = step / BAND_STEPS;
        const [x, y] = quadraticAt(curve, t);
        const [ax, ay] = acrossAt(curve, t);
        const half = (startWidth + (endWidth - startWidth) * t) / 2;

        oneSide.push([x + ax * half, y + ay * half]);
        other.push([x - ax * half, y - ay * half]);
    }

    return [oneSide, other];
};

const polyline = (points: Point[]): string => points
    .map(([x, y], index) => `${index ? 'L' : 'M'} ${round(x)} ${round(y)}`)
    .join(' ');

/**
 * The outline of that band, closed — what a relation's body is drawn as when it is filled in, and
 * why the body follows the bend rather than sitting straight across it.
 *
 * Its two ends are cut square, which is what makes a rectangle a rectangle and a triangle's base
 * a base; a width of nought closes the band to a point, which is the triangle's tip.
 */
export const quadraticBandPath = (curve: Quadratic, startWidth: number, endWidth: number): string => {
    const [oneSide, other] = bandEdges(curve, startWidth, endWidth);

    return polyline([...oneSide, ...other.reverse()]) + ' Z';
};

/**
 * The same band left open at the curve's far end: the square cut where the curve starts, and the
 * two edges away from it. What a hollow body is drawn as — a rectangle, which says what it is by
 * its own outline and has no need of a slab of ink to say it again.
 *
 * Open, because a relation is drawn in two halves that meet at its centre and the far end of each
 * is not an end of anything. Cutting it square there would draw a line across the middle of the
 * body; left open, the two halves' outlines join edge to edge and the relation is one hollow
 * shape running from note to note.
 */
export const quadraticBandOutlinePath = (curve: Quadratic, startWidth: number, endWidth: number): string => {
    const [oneSide, other] = bandEdges(curve, startWidth, endWidth);

    return polyline([...oneSide.reverse(), ...other]);
};
