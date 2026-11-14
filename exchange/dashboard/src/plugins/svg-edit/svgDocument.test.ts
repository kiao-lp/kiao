import { describe, expect, it } from 'vitest';
import { decodeSvg, documentOfDrawing, encodeSvg, emptySvgDocument, pastedShapes } from './svgDocument';
import { emptyDrawing } from './model';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs><linearGradient id="g1"/></defs>
  <rect id="frame" x="10" y="20" width="30" height="40" fill="red"/>
  <circle cx="5" cy="5" r="2"/>
  <text x="1" y="2" font-size="12">Hello &amp; bye</text>
  <mystery foo="bar"/>
</svg>
`;

describe('decodeSvg', () => {
    it('reads the canvas off width/height', () => {
        expect(decodeSvg(SAMPLE).drawing.canvas).toEqual({ width: 400, height: 300 });
    });

    it('reads the canvas off the viewBox where width/height are missing', () => {
        const doc = decodeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 60"><rect/></svg>');
        expect(doc.drawing.canvas).toEqual({ width: 50, height: 60 });
    });

    it('keeps the root attributes besides width/height', () => {
        expect(decodeSvg(SAMPLE).rootAttrs).toEqual({
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 400 300',
        });
    });

    it('keeps a shape id and mints one where there is none', () => {
        const shapes = decodeSvg(SAMPLE).drawing.nodes
            .filter((node): node is { kind: 'shape'; shape: import('./model').SvgShape } => node.kind === 'shape')
            .map(node => node.shape);
        expect(shapes.map(shape => shape.id)[0]).toBe('frame');
        expect(shapes[1].id).toMatch(/^SHAPE-/);
        expect(shapes[1].tag).toBe('circle');
    });

    it('reads a text content unescaped', () => {
        const text = decodeSvg(SAMPLE).drawing.nodes
            .filter((node): node is { kind: 'shape'; shape: import('./model').SvgShape } => node.kind === 'shape')
            .map(node => node.shape)
            .find(shape => shape.tag === 'text');
        expect(text?.text).toBe('Hello & bye');
        expect(text?.attrs['font-size']).toBe('12');
    });

    it('carries defs and unknown elements through as raw nodes', () => {
        const raw = decodeSvg(SAMPLE).drawing.nodes
            .filter((node): node is { kind: 'raw'; xml: string } => node.kind === 'raw')
            .map(node => node.xml);
        expect(raw.some(xml => xml.includes('linearGradient'))).toBe(true);
        expect(raw.some(xml => xml.includes('mystery'))).toBe(true);
    });

    it('throws on a text that holds no svg', () => {
        expect(() => decodeSvg('just prose')).toThrow();
        expect(() => decodeSvg('<html></html>')).toThrow();
    });
});

describe('encodeSvg', () => {
    it('round-trips a document through itself', () => {
        const once = encodeSvg(decodeSvg(SAMPLE));
        expect(encodeSvg(decodeSvg(once))).toBe(once);
    });

    it('keeps the prolog, the defs and the unknown elements', () => {
        const out = encodeSvg(decodeSvg(SAMPLE));
        expect(out).toContain('<?xml version="1.0"');
        expect(out).toContain('linearGradient');
        expect(out).toContain('mystery');
    });

    it('serializes stably: the same document twice is the same text twice', () => {
        const doc = decodeSvg(SAMPLE);
        expect(encodeSvg(doc)).toBe(encodeSvg(doc));
    });
});

describe('emptySvgDocument', () => {
    it('holds an empty drawing under the SVG namespace', () => {
        const doc = emptySvgDocument();
        expect(doc.drawing).toEqual(emptyDrawing());
        expect(encodeSvg(doc)).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('round-trips', () => {
        expect(encodeSvg(decodeSvg(encodeSvg(emptySvgDocument())))).toBe(encodeSvg(emptySvgDocument()));
    });
});

describe('documentOfDrawing', () => {
    it('wraps a bare drawing for the clipboard', () => {
        expect(documentOfDrawing(emptyDrawing()).rootAttrs.xmlns).toBe('http://www.w3.org/2000/svg');
    });
});

describe('pastedShapes', () => {
    it('reads a whole svg and renames what the drawing already holds', () => {
        const shapes = pastedShapes(SAMPLE, new Set(['frame']));
        expect(shapes?.map(shape => shape.tag)).toEqual(['rect', 'circle', 'text']);
        expect(shapes?.[0].id).not.toBe('frame');
    });

    it('reads bare shape elements', () => {
        const shapes = pastedShapes('<rect x="1" y="2" width="3" height="4"/>', new Set());
        expect(shapes?.length).toBe(1);
        expect(shapes?.[0].attrs).toEqual({ x: '1', y: '2', width: '3', height: '4' });
    });

    it('says nothing for prose', () => {
        expect(pastedShapes('just prose', new Set())).toBeNull();
    });
});
