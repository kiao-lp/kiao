import { describe, expect, it } from 'vitest';
import {
    bboxOfShape, boxOfCorners, boxesIntersect, grownShape, idsOf, mapShapes, movedShape,
    restackedShapes, shapeWithBox, SvgNode, SvgShape, translatedTransform, translateOf, withoutShapes,
} from './model';

const rect = (attrs: Record<string, string> = {}): SvgShape =>
    ({ id: 'r1', tag: 'rect', attrs: { x: '10', y: '20', width: '30', height: '40', ...attrs } });

describe('bboxOfShape', () => {
    it('reads a rect off x/y/width/height', () => {
        expect(bboxOfShape(rect())).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });

    it('reads a circle off its centre and radius', () => {
        expect(bboxOfShape({ id: 'c', tag: 'circle', attrs: { cx: '10', cy: '10', r: '5' } }))
            .toEqual({ x: 5, y: 5, width: 10, height: 10 });
    });

    it('reads a line off its two ends', () => {
        expect(bboxOfShape({ id: 'l', tag: 'line', attrs: { x1: '0', y1: '0', x2: '10', y2: '20' } }))
            .toEqual({ x: 0, y: 0, width: 10, height: 20 });
    });

    it('reads a polygon off its points', () => {
        expect(bboxOfShape({ id: 'p', tag: 'polygon', attrs: { points: '0,0 10,0 10,20' } }))
            .toEqual({ x: 0, y: 0, width: 10, height: 20 });
    });

    it('folds a leading translate into the box', () => {
        expect(bboxOfShape(rect({ transform: 'translate(5, 5)' })))
            .toEqual({ x: 15, y: 25, width: 30, height: 40 });
    });

    it('says nothing for text, path and g — the viewport measures those off the DOM', () => {
        expect(bboxOfShape({ id: 't', tag: 'text', attrs: { x: '1', y: '2' }, text: 'hi' })).toBeNull();
        expect(bboxOfShape({ id: 'p', tag: 'path', attrs: { d: 'M0,0 L10,10' } })).toBeNull();
        expect(bboxOfShape({ id: 'g', tag: 'g', attrs: {}, inner: '' })).toBeNull();
    });
});

describe('translateOf / translatedTransform', () => {
    it('reads a leading translate with one or two numbers', () => {
        expect(translateOf('translate(3, 4)')).toEqual([3, 4]);
        expect(translateOf('translate(3)')).toEqual([3, 3]);
        expect(translateOf('rotate(45)')).toEqual([0, 0]);
    });

    it('folds a move into the leading translate and keeps the rest', () => {
        expect(translatedTransform('translate(1, 2) rotate(45)', 3, 4)).toBe('translate(4, 6) rotate(45)');
        expect(translatedTransform(undefined, 3, 4)).toBe('translate(3, 4)');
    });
});

describe('movedShape', () => {
    it('moves a rect by x/y and keeps the rest', () => {
        expect(movedShape(rect({ fill: 'red' }), 5, -5).attrs)
            .toEqual({ x: '15', y: '15', width: '30', height: '40', fill: 'red' });
    });

    it('moves a circle by cx/cy', () => {
        const moved = movedShape({ id: 'c', tag: 'circle', attrs: { cx: '1', cy: '2', r: '3' } }, 1, 1);
        expect(moved.attrs).toEqual({ cx: '2', cy: '3', r: '3' });
    });

    it('moves a line by both ends', () => {
        const moved = movedShape({ id: 'l', tag: 'line', attrs: { x1: '0', y1: '0', x2: '1', y2: '1' } }, 2, 3);
        expect(moved.attrs).toEqual({ x1: '2', y1: '3', x2: '3', y2: '4' });
    });

    it('moves a path by prepending a translate', () => {
        const moved = movedShape({ id: 'p', tag: 'path', attrs: { d: 'M0,0 L1,1' } }, 2, 3);
        expect(moved.attrs).toEqual({ d: 'M0,0 L1,1', transform: 'translate(2, 3)' });
    });
});

describe('shapeWithBox', () => {
    it('fits a rect to the box', () => {
        expect(shapeWithBox(rect(), { x: 0, y: 0, width: 5, height: 6 })?.attrs)
            .toEqual({ x: '0', y: '0', width: '5', height: '6' });
    });

    it('fits a circle to the smaller side, centred', () => {
        expect(shapeWithBox({ id: 'c', tag: 'circle', attrs: {} }, { x: 0, y: 0, width: 10, height: 20 })?.attrs)
            .toEqual({ cx: '5', cy: '10', r: '5' });
    });

    it('maps a line affinely from its old box to the new one', () => {
        const line: SvgShape = { id: 'l', tag: 'line', attrs: { x1: '0', y1: '0', x2: '10', y2: '10' } };
        expect(shapeWithBox(line, { x: 0, y: 0, width: 20, height: 10 })?.attrs)
            .toEqual({ x1: '0', y1: '0', x2: '20', y2: '10' });
    });

    it('offers nothing for text, path and g', () => {
        const box = { x: 0, y: 0, width: 5, height: 5 };
        expect(shapeWithBox({ id: 't', tag: 'text', attrs: {}, text: '' }, box)).toBeNull();
        expect(shapeWithBox({ id: 'p', tag: 'path', attrs: {} }, box)).toBeNull();
        expect(shapeWithBox({ id: 'g', tag: 'g', attrs: {} }, box)).toBeNull();
    });
});

describe('grownShape', () => {
    it('grows a rect about its centre', () => {
        expect(grownShape(rect(), 10, 20)?.attrs)
            .toEqual({ x: '5', y: '10', width: '40', height: '60' });
    });

    it('grows a circle by the mean of the two', () => {
        expect(grownShape({ id: 'c', tag: 'circle', attrs: { cx: '5', cy: '5', r: '5' } }, 4, 4)?.attrs)
            .toEqual({ cx: '5', cy: '5', r: '7' });
    });
});

describe('node lists', () => {
    const nodes: SvgNode[] = [
        { kind: 'raw', xml: '<defs/>' },
        { kind: 'shape', shape: { ...rect(), id: 'a' } },
        { kind: 'shape', shape: { ...rect(), id: 'b' } },
    ];

    it('maps shapes and carries raw nodes through', () => {
        expect(idsOf(mapShapes(nodes, shape => ({ ...shape, id: shape.id.toUpperCase() })))).toEqual(['A', 'B']);
    });

    it('drops the named shapes and nothing else', () => {
        const left = withoutShapes(nodes, ['a']);
        expect(idsOf(left)).toEqual(['b']);
        expect(left[0]).toEqual({ kind: 'raw', xml: '<defs/>' });
    });

    it('restacks the named shapes to one end, in order', () => {
        expect(idsOf(restackedShapes(nodes, ['a'], 'front'))).toEqual(['b', 'a']);
        expect(idsOf(restackedShapes(nodes, ['b'], 'back'))).toEqual(['b', 'a']);
    });
});

describe('boxes over boxes', () => {
    it('intersects overlapping boxes and nothing else', () => {
        const box = { x: 0, y: 0, width: 10, height: 10 };
        expect(boxesIntersect(box, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
        expect(boxesIntersect(box, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
    });

    it('builds a box out of two corners either way round', () => {
        expect(boxOfCorners([10, 20], [0, 5])).toEqual({ x: 0, y: 5, width: 10, height: 15 });
    });
});
