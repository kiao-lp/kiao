import { describe, it, expect } from 'vitest';
import { fitToContent } from './layout-operations';
import { computeContentBox, CONTENT_PADDING } from '../components/ArchDiaSvgRenderer';
import { computeContainerBounds } from './container-bounds';
import { ArchDiaFile, DiagramComponent } from './archdia-model';

/** A file whose two elements sit far from the origin, the way a dragged diagram does. */
function fileWith(positions: Record<string, { x: number; y: number }>): ArchDiaFile {
    return {
        sources: [{ source: '' }],
        layout: { size: { width: 2000, height: 1500 }, positions },
    };
}

const components: DiagramComponent[] = [{ name: 'A' }, { name: 'B' }];

function boxOf(file: ArchDiaFile) {
    const bounds = computeContainerBounds([], components, file.layout.positions);
    return computeContentBox(file.layout.positions, components, bounds)!;
}

describe('fitToContent', () => {

    it('brings the content back inside the size it crops to', () => {
        const file = fileWith({ A: { x: 800, y: 600 }, B: { x: 1000, y: 700 } });

        const fitted = fitToContent(file, boxOf(file));

        const box = boxOf(fitted);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.width).toBeLessThanOrEqual(fitted.layout.size.width);
        expect(box.height).toBeLessThanOrEqual(fitted.layout.size.height);
    });

    it('leaves the same margin on each side, so the content is centred', () => {
        const file = fileWith({ A: { x: 800, y: 600 }, B: { x: 1000, y: 700 } });

        const fitted = fitToContent(file, boxOf(file));

        const { size, positions } = fitted.layout;
        const bounds = computeContainerBounds([], components, positions);
        const box = computeContentBox(positions, components, bounds)!;
        // The content's own extent, the box being that extent plus a margin on each side.
        const contentWidth = box.width - CONTENT_PADDING * 2;
        const contentHeight = box.height - CONTENT_PADDING * 2;
        expect(box.x).toBe(CONTENT_PADDING);
        expect(box.y).toBe(CONTENT_PADDING);
        expect(size.width - (box.x + contentWidth)).toBe(CONTENT_PADDING);
        expect(size.height - (box.y + contentHeight)).toBe(CONTENT_PADDING);
    });

    it('keeps the elements where they are relative to each other', () => {
        const file = fileWith({ A: { x: 800, y: 600 }, B: { x: 1000, y: 700 } });

        const { positions } = fitToContent(file, boxOf(file)).layout;

        expect(positions.B.x - positions.A.x).toBe(200);
        expect(positions.B.y - positions.A.y).toBe(100);
    });

    it('moves nothing when the content already sits at its margin', () => {
        const file = fileWith({ A: { x: CONTENT_PADDING, y: CONTENT_PADDING } });

        const { positions } = fitToContent(file, boxOf(file)).layout;

        expect(positions.A).toEqual({ x: CONTENT_PADDING, y: CONTENT_PADDING });
    });

    it('pulls back content drawn at negative coordinates too', () => {
        const file = fileWith({ A: { x: -300, y: -120 }, B: { x: 0, y: 0 } });

        const fitted = fitToContent(file, boxOf(file));

        const box = boxOf(fitted);
        expect(box.x).toBe(CONTENT_PADDING);
        expect(box.y).toBe(CONTENT_PADDING);
        expect(box.width).toBe(fitted.layout.size.width);
        expect(box.height).toBe(fitted.layout.size.height);
    });
});
