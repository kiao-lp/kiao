import { describe, it, expect } from 'vitest';
import { computeElkLayout, computeIncrementalLayout } from './elk-layout';
import { DiagramScene } from './archdia-model';
import { estimateNodeWidth, getNodeHeight } from './component-sizing';

describe('elk-layout', () => {

    it('generates a valid layout from components + containers + relations', async () => {
        const scene: DiagramScene = {
            components: [
                { name: 'Gateway', alias: 'GW', parentIds: ['Operation'] },
                { name: 'Catalog', alias: 'MSCatalog', parentIds: ['Operation'] },
            ],
            containers: [
                { id: 'Operation', label: '🌐 Operation' },
            ],
            relations: [
                { from: 'GW', to: 'MSCatalog' },
            ],
        };

        const layout = await computeElkLayout(scene);

        expect(layout.size.width).toBeGreaterThan(0);
        expect(layout.size.height).toBeGreaterThan(0);

        // Leaf components should have positions
        expect(layout.positions['GW']).toBeDefined();
        expect(layout.positions['MSCatalog']).toBeDefined();

        // Containers should NOT have positions (computed at render time)
        expect(layout.positions['Operation']).toBeUndefined();

        // Positions should be non-negative
        expect(layout.positions['GW'].x).toBeGreaterThanOrEqual(0);
        expect(layout.positions['GW'].y).toBeGreaterThanOrEqual(0);
    });

    it('only persists leaf component positions (not containers)', async () => {
        const scene: DiagramScene = {
            components: [
                { name: 'A', parentIds: ['box'] },
                { name: 'B', parentIds: ['box'] },
            ],
            containers: [
                { id: 'box', label: 'Box' },
            ],
            relations: [],
        };

        const layout = await computeElkLayout(scene);

        // Container should NOT be in positions
        expect(layout.positions['box']).toBeUndefined();

        // Leaf components should be present
        const aPos = layout.positions['A'];
        const bPos = layout.positions['B'];
        expect(aPos).toBeDefined();
        expect(bPos).toBeDefined();
    });

    it('handles empty scene', async () => {
        const scene: DiagramScene = {
            components: [],
            containers: [],
            relations: [],
        };

        const layout = await computeElkLayout(scene);
        expect(layout.size.width).toBeGreaterThan(0);
        expect(layout.size.height).toBeGreaterThan(0);
        expect(Object.keys(layout.positions)).toHaveLength(0);
    });

    it('handles cross-container relations', async () => {
        const scene: DiagramScene = {
            components: [
                { name: 'Client', alias: 'C', parentIds: ['frontend'] },
                { name: 'Server', alias: 'S', parentIds: ['backend'] },
            ],
            containers: [
                { id: 'frontend', label: 'Frontend' },
                { id: 'backend', label: 'Backend' },
            ],
            relations: [
                { from: 'C', to: 'S', label: 'HTTP' },
            ],
        };

        const layout = await computeElkLayout(scene);

        expect(layout.positions['C']).toBeDefined();
        expect(layout.positions['S']).toBeDefined();
        // Containers should not be in positions
        expect(layout.positions['frontend']).toBeUndefined();
        expect(layout.positions['backend']).toBeUndefined();
    });

    it('never overlaps nodes, even when the content exceeds the viewport', async () => {
        // 20 wide siblings can not fit in the default 925px-wide viewport:
        // positions must overflow it rather than be scaled down onto each other.
        const names = Array.from({ length: 20 }, (_, i) => `Component Number ${i}`);
        const scene: DiagramScene = {
            components: names.map(name => ({ name })),
            containers: [],
            relations: names.slice(1).map(name => ({ from: names[0], to: name })),
        };

        const layout = await computeElkLayout(scene);

        const boxes = names.map(name => {
            const pos = layout.positions[name];
            return { x: pos.x, y: pos.y, w: estimateNodeWidth(name), h: getNodeHeight() };
        });

        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const b = boxes[j];
                const overlaps = a.x < b.x + b.w && b.x < a.x + a.w
                    && a.y < b.y + b.h && b.y < a.y + a.h;
                expect(overlaps, `${names[i]} overlaps ${names[j]}`).toBe(false);
            }
        }
    });

    it('handles components without a container', async () => {
        const scene: DiagramScene = {
            components: [
                { name: 'Standalone' },
                { name: 'InBox', parentIds: ['box'] },
            ],
            containers: [
                { id: 'box', label: 'Box' },
            ],
            relations: [
                { from: 'Standalone', to: 'InBox' },
            ],
        };

        const layout = await computeElkLayout(scene);

        expect(layout.positions['Standalone']).toBeDefined();
        expect(layout.positions['InBox']).toBeDefined();
        // Container should not be in positions
        expect(layout.positions['box']).toBeUndefined();
    });
});

describe('computeIncrementalLayout', () => {
    const scene: DiagramScene = {
        components: [
            { name: 'A', alias: 'A' },
            { name: 'B', alias: 'B' },
            { name: 'C', alias: 'C' },
        ],
        containers: [],
        relations: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' }
        ]
    };

    it('preserves existing positions and places new ones', async () => {
        const existingLayout = {
            size: { width: 1000, height: 800 },
            positions: {
                A: { x: 100, y: 100 },
                C: { x: 500, y: 500 },
            }
        };

        const newKeys = ['B'];
        const result = await computeIncrementalLayout(scene, existingLayout, newKeys);

        // Preserves exact existing positions
        expect(result.positions['A']).toEqual({ x: 100, y: 100 });
        expect(result.positions['C']).toEqual({ x: 500, y: 500 });

        // Adds the new position
        expect(result.positions['B']).toBeDefined();
        // Since it's between A and C, testing it's placed somewhere valid
        expect(result.positions['B'].x).toBeGreaterThanOrEqual(0);
        expect(result.positions['B'].y).toBeGreaterThanOrEqual(0);
    });

    it('handles all-new components gracefully by performing full layout', async () => {
        const existingLayout = {
            size: { width: 1000, height: 800 },
            positions: {} // empty
        };
        const newKeys = ['A', 'B', 'C'];
        const result = await computeIncrementalLayout(scene, existingLayout, newKeys);

        expect(result.positions['A']).toBeDefined();
        expect(result.positions['B']).toBeDefined();
        expect(result.positions['C']).toBeDefined();
    });
});

