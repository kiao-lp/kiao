/**
 * The curve a relation is drawn as, and the centre its author put it at.
 *
 * A relation runs from one element to another through one point — its centre — and the whole of
 * this module is about where that point is and what curve passes through it. Quadratic, because
 * that is the family with exactly one point to spend on saying where a curve goes: the control
 * point follows from the two ends and the centre, and no choice is left over to make.
 *
 * The centre is where the relation would put it itself, moved by the `bend` the layout carries.
 * Nothing about the bend feeds back into that place, so a centre dragged by so much moves by
 * exactly so much — and the curve goes on passing through it whatever the elements then do, the
 * control point being derived from the centre rather than the other way about.
 */

import { getRectIntersection } from '@cms-kit/diagram-shared';
import { DiagramRelation } from './archdia-model';

export type Point = [number, number];

/**
 * Where a relation's centre sits, as an offset from where the relation would put it itself.
 *
 * An offset rather than a place on the canvas, so a bend travels with the elements it hangs
 * between: move them and the curve keeps the shape it was given.
 */
export type RelationBend = [number, number];

/** The box an end of a relation attaches to. */
export interface RelationRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The curve a relation is drawn as: its path, the centre it passes through, and its label's place. */
export interface RelationGeometry {
    /** The point the curve passes through at its middle — where the handle that moves it sits. */
    anchor: Point;
    /** SVG path data for the curve. */
    d: string;
    /** Where the relation's label sits, just above the centre. */
    labelX: number;
    labelY: number;
}

// === Relation keys ===

/**
 * The name a relation's bend is filed under in the LAYOUT block.
 *
 * Relations carry no identifier in the PlantUML source, so one is made from what does not change
 * when a diagram is edited: the two ends. Its label is left out — relabelling a relation must not
 * lose the shape it was given. Several relations between the same pair, written the same way
 * round, are told apart by their order in the source: `A->B`, then `A->B#2`, `A->B#3`.
 */
export function relationKeys(relations: DiagramRelation[]): Map<DiagramRelation, string> {
    const counts = new Map<string, number>();
    const keys = new Map<DiagramRelation, string>();

    for (const relation of relations) {
        const base = `${relation.from}->${relation.to}`;
        const nth = (counts.get(base) ?? 0) + 1;
        counts.set(base, nth);
        keys.set(relation, nth === 1 ? base : `${base}#${nth}`);
    }

    return keys;
}

// === Quadratic curves ===

/** Short of a pixel is short enough for anything drawn, and keeps the path readable. */
const round = (n: number) => Math.round(n * 100) / 100;

/** The control point of the curve that runs from `a` to `b` through `through` at its middle. */
export const controlThrough = (a: Point, b: Point, through: Point): Point =>
    [2 * through[0] - (a[0] + b[0]) / 2, 2 * through[1] - (a[1] + b[1]) / 2];

/** Where a quadratic is at `t` — 0 at its start, 1 at its end, and its middle at a half. */
export const quadraticAt = (p0: Point, p1: Point, p2: Point, t: number): Point => {
    const u = 1 - t;
    return [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
};

// === Geometry ===

const center = (box: RelationRect): Point => [box.x + box.width / 2, box.y + box.height / 2];

const bounds = (box: RelationRect): [number, number, number, number] =>
    [box.x, box.y, box.width, box.height];

const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const movedBy = (point: Point, ...offsets: (Point | undefined)[]): Point =>
    offsets.reduce<Point>((moved, offset) =>
        offset ? [moved[0] + offset[0], moved[1] + offset[1]] : moved, point);

/** How far apart the relations of one pair are fanned. */
const FAN_SPACING = 40;

/** How far above the curve a relation's label sits. */
const LABEL_LIFT = 6;

/** Where a line aimed at `aim` stops against a box: on its border, facing that way. */
const attachPoint = (box: RelationRect, aim: Point): Point =>
    getRectIntersection(aim, center(box), bounds(box));

/**
 * How far to one side a relation is pushed for sharing its pair of elements with others: they are
 * fanned out around the straight line so that none of them hides another. A relation that has the
 * pair to itself is not pushed anywhere, and runs straight unless it is bent.
 *
 * Which side is decided by the two keys in alphabetical order rather than by which end is the
 * source, so a relation written back the other way still lands in the fan rather than on top of
 * the one facing it.
 */
export function relationFanOffset(
    from: RelationRect,
    to: RelationRect,
    fromKey: string,
    toKey: string,
    indexInGroup: number,
    groupSize: number,
): Point {
    if (groupSize <= 1) return [0, 0];

    const spread = (indexInGroup - (groupSize - 1) / 2) * FAN_SPACING;
    const offset = fromKey < toKey ? spread : -spread;

    const [fromX, fromY] = center(from);
    const [toX, toY] = center(to);
    const length = Math.hypot(toX - fromX, toY - fromY) || 1;

    return [-(toY - fromY) / length * offset, (toX - fromX) / length * offset];
}

/**
 * The curve a relation is drawn as.
 *
 * Its centre is the middle of the straight line between the two borders, pushed aside by the fan
 * and then by the bend. An end meets its box on the border facing the centre, so the ends slide
 * towards the bend as it is pulled. They face the centre itself rather than the control point:
 * the control sits twice as far off the line, and facing it slides the ends past the centre on
 * close elements — the bow then points the wrong way until the centre clears the corner.
 * So the border is met twice: once towards the other element's centre, then again towards
 * the anchor.
 *
 * With no fan and no bend the centre lands on the straight line and the control point lands on
 * the centre, so the curve is that straight line: a plain relation is drawn exactly as it was
 * before it could be bent.
 */
export function computeRelationGeometry(
    from: RelationRect,
    to: RelationRect,
    fan: Point = [0, 0],
    bend?: RelationBend,
): RelationGeometry {
    const straightFrom = attachPoint(from, center(to));
    const straightTo = attachPoint(to, center(from));

    const anchor = movedBy(midpoint(straightFrom, straightTo), fan, bend);

    const start = attachPoint(from, anchor);
    const end = attachPoint(to, anchor);
    const control = controlThrough(start, end, anchor);

    return {
        anchor,
        d: `M ${round(start[0])} ${round(start[1])} Q ${round(control[0])} ${round(control[1])} ${round(end[0])} ${round(end[1])}`,
        labelX: anchor[0],
        labelY: anchor[1] - LABEL_LIFT,
    };
}

/** How much of a cubic's middle the two control points account for: a curve at `t` = 0.5. */
const CUBIC_MIDDLE_FROM_CONTROLS = 0.75;

/**
 * The loop a relation from an element to itself is drawn as: out of the top, round, and back into
 * the right-hand side, each further loop of the same element drawn wider than the last.
 *
 * A bend moves both of its control points rather than its ends, which are pinned to the element:
 * the two of them account for three quarters of where the middle of a cubic is, so moving them by
 * four thirds of the bend moves that middle by exactly the bend, and the loop stays a loop.
 */
export function computeSelfLoopGeometry(
    box: RelationRect,
    indexInGroup: number,
    bend?: RelationBend,
): RelationGeometry {
    const [centreX, centreY] = center(box);
    const size = 40 + indexInGroup * 20;

    const start: Point = [centreX + 10, box.y];
    const end: Point = [box.x + box.width, centreY + 10];

    const shift = bend ? bend.map(d => d / CUBIC_MIDDLE_FROM_CONTROLS) as Point : undefined;
    const control1 = movedBy([start[0], start[1] - size], shift);
    const control2 = movedBy([end[0] + size, end[1]], shift);

    const at = (index: 0 | 1) =>
        0.125 * start[index] + 0.375 * control1[index] + 0.375 * control2[index] + 0.125 * end[index];
    const anchor: Point = [at(0), at(1)];

    return {
        anchor,
        d: `M ${round(start[0])} ${round(start[1])} C ${round(control1[0])} ${round(control1[1])} ${round(control2[0])} ${round(control2[1])} ${round(end[0])} ${round(end[1])}`,
        labelX: anchor[0] + LABEL_LIFT,
        labelY: anchor[1] - LABEL_LIFT,
    };
}
