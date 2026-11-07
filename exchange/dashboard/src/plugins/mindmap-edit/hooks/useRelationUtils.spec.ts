import { describe, it, expect } from 'vitest';

import { computeRelationGeometry, relationBodyWidths, relationEndCurve } from './useRelationUtils';
import { Bounds } from '../lib/geom2d';
import { quadraticAt } from '../lib/quadratic';
import { Mindmap, MindmapRelation, Note, NoteShape, RELATION_LINE_WIDTH } from '../model';

const note = (id: string, bounds?: Bounds, shape?: NoteShape): Note => ({
    id,
    userBounds: [bounds ? bounds[0] : 0, bounds ? bounds[1] : 0, null, null],
    bounds,
    shape,
    content: id
});

const relation = (from: string, to: string, bend?: [number, number]): MindmapRelation => ({
    id: 'REL-1',
    ends: [{ id: `END-${from}`, target: from }, { id: `END-${to}`, target: to }],
    ...(bend && { bend })
});

const mindmapOf = (notes: Note[]): Mindmap => ({ elements: { notes, relations: [] } });

describe('computeRelationGeometry', () => {
    it('anchors a relation halfway along it, and attaches it on the sides facing that', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b', [100, 0, 40, 20])]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap);

        expect(geometry).not.toBeNull();
        expect(geometry!.anchor).toEqual([70, 10]);
        expect(geometry!.attachPoints).toEqual([[40, 10], [100, 10]]);
    });

    // The middle the bend is measured from is where the relation would be if it were straight, and the attach points sliding around.
    it('moves the centre by exactly the bend, and turns the ends to face where it went', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b', [100, 0, 40, 20])]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b', [0, -20]), mindmap);

        expect(geometry!.anchor).toEqual([70, -10]);
        expect(geometry!.attachPoints).toEqual([[40, 2], [100, 2]]);
    });

    // A small bend must bow the curve the way it was pulled, even between close notes: the ends slide towards the bend, but never past.
    it('bows a relation the way its centre was pulled, however close its notes', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 40]), note('NOTE-b', [50, 0, 40, 40])]);

        const { anchor, attachPoints } =
            computeRelationGeometry(relation('NOTE-a', 'NOTE-b', [0, -8]), mindmap)!;

        const chordMidY = (attachPoints[0][1] + attachPoints[1][1]) / 2;
        expect(anchor[1]).toBeLessThan(chordMidY);
    });

    it('curves through the centre, whatever the bend', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b', [100, 0, 40, 20])]);

        [[0, -20], [80, 60], [-30, 0]].forEach(bend => {
            const { anchor, control, attachPoints } =
                computeRelationGeometry(relation('NOTE-a', 'NOTE-b', bend as [number, number]), mindmap)!;

            const [x, y] = quadraticAt([attachPoints[0], control, attachPoints[1]], 0.5);
            expect([x, y]).toEqual(anchor);
        });
    });

    it('cuts the curve into the halves its two ends draw', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b', [100, 0, 40, 20])]);
        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b', [0, -60]), mindmap)!;
        const whole = [geometry.attachPoints[0], geometry.control, geometry.attachPoints[1]] as const;

        const half = relationEndCurve(geometry.attachPoints[0], geometry);

        expect(half[0]).toEqual(geometry.attachPoints[0]);
        expect(half[2]).toEqual(geometry.anchor);
        const [hx, hy] = quadraticAt(half, 0.5);
        const [wx, wy] = quadraticAt([whole[0], whole[1], whole[2]], 0.25);
        expect(hx).toBeCloseTo(wx, 10);
        expect(hy).toBeCloseTo(wy, 10);
    });

    it('leaves an unbent relation the straight line between its notes', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b', [100, 0, 40, 20])]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap);

        expect(geometry!.control).toEqual(geometry!.anchor);
    });

    it('carries a bend along with the notes it hangs between', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 100, 40, 20]), note('NOTE-b', [100, 100, 40, 20])]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b', [0, -20]), mindmap);

        expect(geometry!.anchor).toEqual([70, 90]);
    });

    it('stops a line on the ellipse a note is drawn as, not on the corner of its bounds', () => {
        const mindmap = mindmapOf([
            note('NOTE-a', [0, 0, 20, 20], 'ellipse'),
            note('NOTE-b', [60, 80, 20, 20], 'ellipse')
        ]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap);

        expect(geometry!.attachPoints).toEqual([[16, 18], [64, 82]]);
    });

    it('stops a line on the diamond a note is drawn as, not on the corner of its bounds', () => {
        const mindmap = mindmapOf([
            note('NOTE-a', [0, 0, 20, 20], 'diamond'),
            note('NOTE-b', [60, 40, 20, 20], 'diamond')
        ]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap);

        expect(geometry!.attachPoints).toEqual([[16, 14], [64, 46]]);
    });

    it('brings an end pinned to a numbered place onto the shape as well', () => {
        const pinned: MindmapRelation = {
            ...relation('NOTE-a', 'NOTE-b'),
            ends: [{ id: 'END-a', target: 'NOTE-a', attachPointNumber: 2 }, { id: 'END-b', target: 'NOTE-b' }]
        };
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 30, 60], 'diamond'), note('NOTE-b', [200, 0, 30, 60])]);

        const geometry = computeRelationGeometry(pinned, mindmap);

        expect(geometry!.attachPoints[0]).toEqual([25, 20]);
    });

    it('leaves a note of no shape stopping its lines on its bounds', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 20, 20]), note('NOTE-b', [60, 80, 20, 20])]);

        const geometry = computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap);

        expect(geometry!.attachPoints).toEqual([[17.5, 20], [62.5, 80]]);
    });

    it('draws nothing for a relation whose target is gone, rather than throwing', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20])]);

        expect(computeRelationGeometry(relation('NOTE-a', 'NOTE-gone'), mindmap)).toBeNull();
    });

    it('waits for a note that has not been measured yet', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20]), note('NOTE-b')]);

        expect(computeRelationGeometry(relation('NOTE-a', 'NOTE-b'), mindmap)).toBeNull();
    });

    it('draws nothing for a relation that a file left with a single end', () => {
        const mindmap = mindmapOf([note('NOTE-a', [0, 0, 40, 20])]);
        const single = { id: 'REL-1', ends: [{ id: 'END-a', target: 'NOTE-a' }] };

        expect(computeRelationGeometry(single as unknown as MindmapRelation, mindmap)).toBeNull();
    });
});

describe('relationBodyWidths', () => {
    const widthed = (...widths: (number | undefined)[]): MindmapRelation => ({
        id: 'REL-1',
        ends: [
            { id: 'END-a', target: 'NOTE-a', ...(widths[0] !== undefined && { width: widths[0] }) },
            { id: 'END-b', target: 'NOTE-b', ...(widths[1] !== undefined && { width: widths[1] }) }
        ]
    });

    it('gives nothing for a relation that is the line, which is stroked and not filled', () => {
        expect(relationBodyWidths(widthed())).toBeNull();
    });

    it('gives the width each end asks for', () => {
        expect(relationBodyWidths(widthed(30, 30))).toEqual([30, 30]);
        expect(relationBodyWidths(widthed(0, 40))).toEqual([0, 40]);
    });

    // A body against an end that never asked for one: that end is as wide as the line is.
    it('takes an end with no width of its own to be as wide as the line', () => {
        expect(relationBodyWidths(widthed(undefined, 40))).toEqual([RELATION_LINE_WIDTH, 40]);
    });
});
