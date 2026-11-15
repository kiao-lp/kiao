import { describe, it, expect } from 'vitest';
import { DiagramRelation } from './archdia-model';
import {
    Point, RelationBend, RelationRect, computeRelationGeometry, computeSelfLoopGeometry,
    quadraticAt, relationFanOffset, relationKeys,
} from './relation-geometry';

const box = (x: number, y: number): RelationRect => ({ x, y, width: 100, height: 60 });

/** The three points of the quadratic a geometry drew, read back off its path. */
const curveOf = (d: string): [Point, Point, Point] => {
    const [sx, sy, cx, cy, ex, ey] = d.match(/-?[\d.]+/g)!.map(Number);
    return [[sx, sy], [cx, cy], [ex, ey]];
};

const relation = (from: string, to: string, label?: string): DiagramRelation => ({ from, to, label });

describe('relation keys', () => {
    it('names a relation by its two ends', () => {
        const relations = [relation('API', 'DB')];
        expect(relationKeys(relations).get(relations[0])).toBe('API->DB');
    });

    // Relabelling a relation must not lose the shape its author gave it.
    it('names it the same whatever it is labelled, and whichever way round it is read', () => {
        const relations = [relation('API', 'DB', 'reads'), relation('DB', 'API')];
        const keys = relationKeys(relations);

        expect(keys.get(relations[0])).toBe('API->DB');
        expect(keys.get(relations[1])).toBe('DB->API');
    });

    it('tells apart several relations written the same way round between the same pair', () => {
        const relations = [relation('API', 'DB', 'reads'), relation('API', 'DB', 'writes')];
        const keys = relationKeys(relations);

        expect([...keys.values()]).toEqual(['API->DB', 'API->DB#2']);
    });
});

describe('the curve a relation is drawn as', () => {
    // Nothing about a plain diagram changes for relations having become bendable.
    it('runs straight when it is not bent, and puts its centre in the middle', () => {
        const { anchor, d, labelX, labelY } = computeRelationGeometry(box(0, 0), box(300, 0));
        const [start, control, end] = curveOf(d);

        expect(control).toEqual([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);
        expect(anchor).toEqual([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);
        expect([labelX, labelY]).toEqual([anchor[0], anchor[1] - 6]);
    });

    // What the whole thing is for: wherever the centre is put, the curve goes through it.
    it('passes through its centre, whatever the bend', () => {
        for (const bend of [[0, -80], [120, 40], [-30, 0]] as RelationBend[]) {
            const { anchor, d } = computeRelationGeometry(box(0, 0), box(300, 200), [0, 0], bend);
            const [x, y] = quadraticAt(...curveOf(d), 0.5);

            expect(x).toBeCloseTo(anchor[0], 1);
            expect(y).toBeCloseTo(anchor[1], 1);
        }
    });

    // The bend is an offset, not a place on the canvas: the elements take it with them.
    it('moves the centre by exactly the bend, and carries it along with the elements', () => {
        const straight = computeRelationGeometry(box(0, 0), box(300, 0));
        const bent = computeRelationGeometry(box(0, 0), box(300, 0), [0, 0], [10, -50]);

        expect(bent.anchor).toEqual([straight.anchor[0] + 10, straight.anchor[1] - 50]);

        const moved = computeRelationGeometry(box(40, 25), box(340, 25), [0, 0], [10, -50]);
        expect(moved.anchor).toEqual([bent.anchor[0] + 40, bent.anchor[1] + 25]);
    });

    // Each end leaves its box facing the way the curve goes, not the way a straight line would.
    it('meets each element on the side the curve leaves it by', () => {
        const { d } = computeRelationGeometry(box(0, 0), box(300, 0), [0, 0], [0, -200]);
        const [start, , end] = curveOf(d);

        expect(start[1]).toBe(0);
        expect(end[1]).toBe(0);
    });

    // A small bend must bow the curve the way it was pulled, even between close elements: the
    // ends slide towards the bend, but never past the centre — or the bow points the wrong
    // way until the centre clears the corner.
    it('bows a relation the way its centre was pulled, however close its elements', () => {
        const { anchor, d } = computeRelationGeometry(box(0, 0), box(120, 0), [0, 0], [0, -8]);
        const [start, , end] = curveOf(d);

        expect(anchor[1]).toBeLessThan((start[1] + end[1]) / 2);
    });

    it('fans relations that share a pair to either side, and leaves a lone one alone', () => {
        const from = box(0, 0);
        const to = box(300, 0);

        expect(relationFanOffset(from, to, 'A', 'B', 0, 1)).toEqual([0, 0]);

        // Across the line, which here runs east, so the two are pushed the same way apart.
        const [first, second] = [0, 1].map(index => relationFanOffset(from, to, 'A', 'B', index, 2));
        expect([first[1], second[1]]).toEqual([-20, 20]);
        expect(first[0]).toBeCloseTo(0, 6);
        expect(second[0]).toBeCloseTo(0, 6);
    });

    it('fans a relation written backwards onto the same side as the one facing it', () => {
        const forward = relationFanOffset(box(0, 0), box(300, 0), 'A', 'B', 0, 2);
        const backward = relationFanOffset(box(300, 0), box(0, 0), 'B', 'A', 0, 2);

        expect(backward[1]).toBeCloseTo(forward[1], 6);
    });
});

describe('the loop a relation from an element to itself is drawn as', () => {
    it('moves its middle by exactly the bend, and stays pinned to the element', () => {
        const plain = computeSelfLoopGeometry(box(100, 100), 0);
        const bent = computeSelfLoopGeometry(box(100, 100), 0, [30, -40]);

        expect(bent.anchor[0]).toBeCloseTo(plain.anchor[0] + 30, 6);
        expect(bent.anchor[1]).toBeCloseTo(plain.anchor[1] - 40, 6);

        const ends = (d: string) => [d.match(/^M (\S+ \S+)/)![1], d.match(/(\S+ \S+)$/)![1]];
        expect(ends(bent.d)).toEqual(ends(plain.d));
    });

    it('draws each further loop of the same element wider than the last', () => {
        const first = computeSelfLoopGeometry(box(100, 100), 0);
        const second = computeSelfLoopGeometry(box(100, 100), 1);

        expect(second.anchor[0]).toBeGreaterThan(first.anchor[0]);
        expect(second.anchor[1]).toBeLessThan(first.anchor[1]);
    });
});
