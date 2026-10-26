import { describe, it, expect } from 'vitest';
import { computeContainerBounds } from './container-bounds';
import { DiagramComponent, DiagramContainer, ComponentPosition } from './archdia-model';

describe('computeContainerBounds', () => {

    it('computes bounds around children with margin', () => {
        const containers: DiagramContainer[] = [
            { id: 'box', label: 'Box' },
        ];
        const components: DiagramComponent[] = [
            { name: 'A', parentIds: ['box'] },
            { name: 'B', parentIds: ['box'] },
        ];
        const positions: Record<string, ComponentPosition> = {
            A: { x: 100, y: 100 },
            B: { x: 300, y: 200 },
        };

        const bounds = computeContainerBounds(containers, components, positions);

        expect(bounds['box']).toBeDefined();
        // A is "A" -> width 60, height 39. x=100, y=100. maxX=160, maxY=139.
        // B is "B" -> width 60, height 39. x=300, y=200. maxX=360, maxY=239.
        // minX=100, minY=100, maxX=360, maxY=239
        expect(bounds['box'].x).toBeLessThan(100);
        expect(bounds['box'].y).toBeLessThan(100);
        expect(bounds['box'].x + bounds['box'].width).toBeGreaterThan(360);
        expect(bounds['box'].y + bounds['box'].height).toBeGreaterThan(239);
    });

    it('handles nested containers (processes bottom-up)', () => {
        const containers: DiagramContainer[] = [
            { id: 'outer', label: 'Outer' },
            { id: 'inner', label: 'Inner', parentId: 'outer' },
        ];
        const components: DiagramComponent[] = [
            { name: 'Child', parentIds: ['inner'] },
        ];
        const positions: Record<string, ComponentPosition> = {
            Child: { x: 50, y: 50 },
        };

        const bounds = computeContainerBounds(containers, components, positions);

        expect(bounds['inner']).toBeDefined();
        expect(bounds['outer']).toBeDefined();

        // Outer should encompass inner
        expect(bounds['outer'].x).toBeLessThanOrEqual(bounds['inner'].x);
        expect(bounds['outer'].y).toBeLessThanOrEqual(bounds['inner'].y);
        expect(bounds['outer'].x + bounds['outer'].width).toBeGreaterThanOrEqual(
            bounds['inner'].x + bounds['inner'].width,
        );
        expect(bounds['outer'].y + bounds['outer'].height).toBeGreaterThanOrEqual(
            bounds['inner'].y + bounds['inner'].height,
        );
    });

    it('handles container with no positioned children', () => {
        const containers: DiagramContainer[] = [
            { id: 'empty', label: 'Empty' },
        ];
        const positions: Record<string, ComponentPosition> = {};

        const bounds = computeContainerBounds(containers, [], positions);

        expect(bounds['empty']).toBeDefined();
        expect(bounds['empty'].width).toBeGreaterThan(0);
        expect(bounds['empty'].height).toBeGreaterThan(0);
    });

    it('returns empty record when there are no containers', () => {
        const bounds = computeContainerBounds([], [], {});
        expect(Object.keys(bounds)).toHaveLength(0);
    });

    it('fits multiple containers around a component with multiple parentIds', () => {
        const containers: DiagramContainer[] = [
            { id: 'structure', label: 'Structure' },
            { id: 'trust', label: 'Trust Boundary' },
        ];
        const components: DiagramComponent[] = [
            { name: 'API', parentIds: ['structure', 'trust'] },
        ];
        const positions: Record<string, ComponentPosition> = {
            API: { x: 100, y: 100 },
        };

        const bounds = computeContainerBounds(containers, components, positions);

        // Both containers should have bounds computed from the same child
        expect(bounds['structure']).toBeDefined();
        expect(bounds['trust']).toBeDefined();
        expect(bounds['structure'].x).toBeLessThan(100);
        expect(bounds['trust'].x).toBeLessThan(100);
    });

    it('draws a deployable perimeter outside the container it cuts across', () => {
        const containers: DiagramContainer[] = [
            { id: 'authoring', label: 'Authoring', stereotype: 'district' },
            { id: 'dashboard', label: 'dashboard', stereotype: 'deployable' },
        ];
        const components: DiagramComponent[] = [
            { name: 'Document management', parentIds: ['authoring', 'dashboard'] },
        ];
        const positions: Record<string, ComponentPosition> = {
            'Document management': { x: 300, y: 200 },
        };

        const bounds = computeContainerBounds(containers, components, positions);

        // Same child, so the perimeter can only be told from the district by its margins:
        // it sits outside on every side, and higher up, where its own label goes.
        expect(bounds['dashboard'].x).toBeLessThan(bounds['authoring'].x);
        expect(bounds['dashboard'].y).toBeLessThan(bounds['authoring'].y);
        expect(bounds['dashboard'].width).toBeGreaterThan(bounds['authoring'].width);
        expect(bounds['dashboard'].height).toBeGreaterThan(bounds['authoring'].height);
    });
});
