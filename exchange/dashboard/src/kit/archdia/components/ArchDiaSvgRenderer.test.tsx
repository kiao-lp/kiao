/** @vitest-environment jsdom */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from 'src/test/render';
import { ArchDiaSvgRenderer, DisplayOptions } from './ArchDiaSvgRenderer';
import { DiagramScene, ArchDiaLayout } from '../lib/archdia-model';

describe('ArchDiaSvgRenderer rendering', () => {

    const scene: DiagramScene = {
        components: [
            {
                name: 'UserClass',
                type: 'class',
                members: [
                    { kind: 'property', text: 'id: string', visibility: '+' },
                    { kind: 'method', text: 'login(password: string): boolean', visibility: '+' }
                ]
            },
            {
                name: 'AuthService',
                type: 'component',
                stereotype: 'service'
            }
        ],
        containers: [],
        relations: []
    };

    const layout: ArchDiaLayout = {
        size: { width: 1000, height: 800 },
        positions: {
            UserClass: { x: 100, y: 100 },
            AuthService: { x: 400, y: 100 }
        }
    };

    it('renders class diagrams with properties and methods', () => {
        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} />
        );

        const svgText = container.textContent || '';

        // Name of the class
        expect(svgText).toContain('UserClass');

        // Property
        expect(svgText).toContain('+ id: string');

        // Method
        expect(svgText).toContain('+ login(password: string): boolean');
    });

    it('hides methods when displayOptions.showMethods is false', () => {
        const displayOptions: DisplayOptions = {
            showMethods: false,
            showProperties: true,
            showTypes: true
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} displayOptions={displayOptions} />
        );

        const svgText = container.textContent || '';
        expect(svgText).toContain('+ id: string');
        expect(svgText).not.toContain('+ login(password: string): boolean');
    });

    it('hides properties when displayOptions.showProperties is false', () => {
        const displayOptions: DisplayOptions = {
            showMethods: true,
            showProperties: false,
            showTypes: true
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} displayOptions={displayOptions} />
        );

        const svgText = container.textContent || '';
        expect(svgText).not.toContain('+ id: string');
        expect(svgText).toContain('+ login(password: string): boolean');
    });

    it('strips types from properties and methods when displayOptions.showTypes is false', () => {
        const displayOptions: DisplayOptions = {
            showMethods: true,
            showProperties: true,
            showTypes: false
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} displayOptions={displayOptions} />
        );

        const svgText = container.textContent || '';

        // Types should be stripped by `stripTypes`
        expect(svgText).toContain('+ id');
        expect(svgText).not.toContain('+ id: string');

        expect(svgText).toContain('+ login(password)');
        expect(svgText).not.toContain('+ login(password: string): boolean');
    });

    it('renders components with stereotypes', () => {
        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} />
        );

        const svgText = container.textContent || '';

        // Component name
        expect(svgText).toContain('AuthService');

        // Stereotype
        expect(svgText).toContain('«service»');
    });

    it('renders urbanization map elements with correct CSS classes', () => {
        const urmScene: DiagramScene = {
            components: [
                {
                    name: 'Fuzzy Search',
                    type: 'rectangle', // 'block' is the stereotype, but 'rectangle' is the type keyword from PlantUML
                    stereotype: 'block',
                    parentIds: ['Discovery Experience'] // belongs to district
                }
            ],
            containers: [
                {
                    id: 'Operational Zone',
                    label: 'Operational Zone',
                    stereotype: 'zone'
                },
                {
                    id: 'Discovery Experience',
                    label: 'Discovery Experience',
                    stereotype: 'district',
                    parentId: 'Operational Zone' // belongs to zone
                }
            ],
            relations: []
        };

        const urmLayout: ArchDiaLayout = {
            size: { width: 1000, height: 800 },
            positions: {
                'Fuzzy Search': { x: 150, y: 150 }
                // Container bounds are computed, no need for positioning here
            }
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={urmLayout} scene={urmScene} />
        );

        // Check for Zone container rendering & class
        const zoneGroup = container.querySelector('.archdia-container-zone');
        expect(zoneGroup).not.toBeNull();
        expect(zoneGroup?.textContent).toContain('Operational Zone');
        expect(zoneGroup?.textContent).not.toContain('«zone»');

        // Check for District container rendering & class
        const districtGroup = container.querySelector('.archdia-container-district');
        expect(districtGroup).not.toBeNull();
        expect(districtGroup?.textContent).toContain('Discovery Experience');
        expect(districtGroup?.textContent).not.toContain('«district»');

        // Check for Block component rendering & class
        const blockGroup = container.querySelector('.archdia-component-block');
        expect(blockGroup).not.toBeNull();
        expect(blockGroup?.textContent).toContain('Fuzzy Search');
        expect(blockGroup?.textContent).not.toContain('«block»');
    });

    it('renders a deployable perimeter with its name and no stereotype text', () => {
        const scene: DiagramScene = {
            components: [
                {
                    name: 'Document management',
                    type: 'rectangle',
                    stereotype: 'block',
                    // One role, two readings: the district it belongs to and the unit it ships in.
                    parentIds: ['Authoring', 'dashboard'],
                }
            ],
            containers: [
                { id: 'Authoring', label: 'Authoring', stereotype: 'district' },
                { id: 'dashboard', label: 'dashboard', stereotype: 'deployable' },
            ],
            relations: []
        };

        const layout: ArchDiaLayout = {
            size: { width: 1000, height: 800 },
            positions: { 'Document management': { x: 300, y: 200 } },
        };

        const { container } = render(<ArchDiaSvgRenderer layout={layout} scene={scene} />);

        const deployableGroup = container.querySelector('.archdia-container-deployable');
        expect(deployableGroup).not.toBeNull();
        // Unlike a trust boundary, a perimeter carries its name — that is what it is for.
        expect(deployableGroup?.textContent).toContain('dashboard');
        expect(deployableGroup?.textContent).not.toContain('«deployable»');
    });

    it('renders ArchiMate leaves with their class and no stereotype text', () => {
        const scene: DiagramScene = {
            components: [
                { name: 'Content authoring', type: 'rectangle', stereotype: 'app-service', parentIds: ['dashboard'] },
                { name: 'Plugin hosting', type: 'rectangle', stereotype: 'app-function', parentIds: ['dashboard'] },
            ],
            containers: [{ id: 'dashboard', label: 'dashboard', stereotype: 'deployable' }],
            relations: []
        };

        const layout: ArchDiaLayout = {
            size: { width: 800, height: 600 },
            positions: { 'Content authoring': { x: 100, y: 100 }, 'Plugin hosting': { x: 100, y: 200 } },
        };

        const { container } = render(<ArchDiaSvgRenderer layout={layout} scene={scene} />);

        expect(container.querySelector('.archdia-component-app-service')).not.toBeNull();
        expect(container.querySelector('.archdia-component-app-function')).not.toBeNull();
        expect(container.textContent).not.toContain('«app-service»');
        expect(container.textContent).not.toContain('«app-function»');
    });

    it('renders multiple relations between same nodes as bezier curves', () => {
        const multiRelScene: DiagramScene = {
            components: [
                { name: 'A', type: 'component' },
                { name: 'B', type: 'component' }
            ],
            containers: [],
            relations: [
                { from: 'A', to: 'B', label: 'rel1' },
                { from: 'A', to: 'B', label: 'rel2' }
            ]
        };

        const multiRelLayout: ArchDiaLayout = {
            size: { width: 500, height: 500 },
            positions: {
                'A': { x: 100, y: 100 },
                'B': { x: 300, y: 100 }
            }
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={multiRelLayout} scene={multiRelScene} />
        );

        const relationPaths = container.querySelectorAll('.archdia-relation-line');
        expect(relationPaths.length).toBe(2);

        // Check if the lines use bezier curves (contain 'Q') instead of straight lines ('L')
        const pathData1 = relationPaths[0].getAttribute('d');
        const pathData2 = relationPaths[1].getAttribute('d');

        expect(pathData1).toContain('Q');
        expect(pathData1).not.toContain(' L ');
        expect(pathData2).toContain('Q');
    });

    it('renders recursive relations on the same node as cubic bezier loops', () => {
        const recursiveScene: DiagramScene = {
            components: [
                { name: 'A', type: 'component' }
            ],
            containers: [],
            relations: [
                { from: 'A', to: 'A', label: 'self-loop' }
            ]
        };

        const recursiveLayout: ArchDiaLayout = {
            size: { width: 500, height: 500 },
            positions: {
                'A': { x: 100, y: 100 }
            }
        };

        const { container } = render(
            <ArchDiaSvgRenderer layout={recursiveLayout} scene={recursiveScene} />
        );

        const relationPaths = container.querySelectorAll('.archdia-relation-line');
        expect(relationPaths.length).toBe(1);

        // Check if the lines use cubic bezier curves (contain 'C')
        const pathData = relationPaths[0].getAttribute('d');

        expect(pathData).toContain('C');
        expect(pathData).not.toContain(' L ');
        expect(pathData).not.toContain(' Q '); // Not quadratic, since we need a loop

        // Check that label is placed correctly (renders the text)
        expect(container.textContent).toContain('self-loop');
    });

    it('renders descriptions as foreignObject tooltips with HTML content (CSS powered)', () => {
        const descriptionsRaw = `## UserClass

This is a **bold** description with \`code\`.`;

        const { container } = render(
            <ArchDiaSvgRenderer layout={layout} scene={scene} descriptionsRaw={descriptionsRaw} />
        );

        // Under the new CSS-powered tooltip model, the inline tooltip should be structurally present
        const tooltip = container.querySelector('.archdia-inline-tooltip');
        expect(tooltip).not.toBeNull();

        // Tooltip body should contain rendered HTML
        const tooltipBody = container.querySelector('.archdia-tooltip-body');
        expect(tooltipBody).not.toBeNull();
        expect(tooltipBody?.innerHTML).toContain('<strong>bold</strong>');
        expect(tooltipBody?.innerHTML).toContain('<code>code</code>');
    });

    describe('C4 elements', () => {
        const c4Scene: DiagramScene = {
            components: [
                { name: 'Storefront', alias: 'storefront', type: 'rectangle', description: 'Cart & checkout' },
                { name: 'PSP', alias: 'psp', type: 'rectangle', external: true, description: 'Payment provider' },
            ],
            containers: [
                { id: 'ep', label: 'Elastic Path', stereotype: 'enterprise', description: 'The commerce platform' },
            ],
            relations: [
                { from: 'storefront', to: 'psp', label: 'Pays', description: 'Retries three times' },
            ],
        };

        const c4Layout: ArchDiaLayout = {
            size: { width: 1000, height: 800 },
            positions: {
                storefront: { x: 100, y: 100 },
                psp: { x: 400, y: 300 },
            },
        };

        it('marks external elements with their own class', () => {
            const { container } = render(<ArchDiaSvgRenderer layout={c4Layout} scene={c4Scene} />);

            const externals = container.querySelectorAll('.archdia-component-external');
            expect(externals.length).toBe(1);
            expect(externals[0].textContent).toContain('PSP');
        });

        it('shows inline element and relation descriptions as tooltips', () => {
            const { container } = render(<ArchDiaSvgRenderer layout={c4Layout} scene={c4Scene} />);

            const tooltips = [...container.querySelectorAll('.archdia-tooltip-body')]
                .map(t => t.textContent);
            expect(tooltips).toEqual(expect.arrayContaining([
                expect.stringContaining('Cart & checkout'),
                expect.stringContaining('Payment provider'),
                expect.stringContaining('The commerce platform'),
                expect.stringContaining('Retries three times'),
            ]));
        });

        it('lets a DESCRIPTIONS entry override an inline description', () => {
            const { container } = render(
                <ArchDiaSvgRenderer
                    layout={c4Layout}
                    scene={c4Scene}
                    descriptionsRaw={'## storefront\n\nThe **real** description.'}
                />
            );

            const tooltips = [...container.querySelectorAll('.archdia-tooltip-body')]
                .map(t => t.textContent ?? '');
            expect(tooltips.some(t => t.includes('The real description.'))).toBe(true);
            expect(tooltips.some(t => t.includes('Cart & checkout'))).toBe(false);
        });
    });

    describe('moving a relation\'s centre', () => {

        const bendScene: DiagramScene = {
            components: [
                { name: 'A', type: 'component' },
                { name: 'B', type: 'component' },
            ],
            containers: [],
            relations: [{ from: 'A', to: 'B', label: 'calls' }],
        };

        const bendLayout: ArchDiaLayout = {
            size: { width: 500, height: 500 },
            positions: { A: { x: 100, y: 100 }, B: { x: 300, y: 100 } },
        };

        const handleOf = (container: HTMLElement) =>
            container.querySelector('[data-archdia-bend="A->B"]')!;

        // jsdom draws nothing, so it has no screen transform to offer; without one the renderer
        // reads pointer coordinates as canvas coordinates, which is what this test gives it.
        const canvasOf = (container: HTMLElement) => {
            const svg = container.querySelector('svg')! as SVGSVGElement;
            svg.getScreenCTM = () => null;
            return svg;
        };

        // A diagram being read, or exported, has no handles: they belong to the editing of it.
        it('offers a handle only where the centre can be moved', () => {
            const { container: readOnly } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} />
            );
            expect(readOnly.querySelector('.archdia-relation-handle')).toBeNull();

            const { container } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} onBendsChange={() => { }} />
            );
            expect(container.querySelector('.archdia-relation-handle')).not.toBeNull();
        });

        it('reports how far the centre was dragged, under the relation\'s own key', () => {
            const bends: Record<string, unknown>[] = [];
            const { container } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} onBendsChange={u => bends.push(u)} />
            );

            const svg = canvasOf(container);
            fireEvent.mouseDown(handleOf(container), { clientX: 200, clientY: 130 });
            fireEvent.mouseMove(svg, { clientX: 240, clientY: 60 });
            fireEvent.mouseUp(svg);

            expect(bends).toEqual([{ 'A->B': [40, -70] }]);
        });

        it('draws the curve through the centre it was given, and moves the label there', () => {
            const { container } = render(
                <ArchDiaSvgRenderer
                    layout={{ ...bendLayout, bends: { 'A->B': [0, -60] } }}
                    scene={bendScene}
                />
            );

            const d = container.querySelector('.archdia-relation-line')!.getAttribute('d')!;
            const [startY, controlY, endY] = d.match(/-?[\d.]+/g)!.map(Number).filter((_, i) => i % 2);

            // Both elements sit at y 100 and stand 39 tall, so a relation between them runs at
            // 119.5 and one bent 60 upwards passes through 59.5 — which is where the label goes too.
            expect((startY + 2 * controlY + endY) / 4).toBeCloseTo(59.5, 6);
            expect(Number(container.querySelector('.archdia-relation-label')!.getAttribute('y')))
                .toBe(59.5 - 6);
        });

        it('straightens the relation again when its centre is double-clicked', () => {
            const bends: Record<string, unknown>[] = [];
            const { container } = render(
                <ArchDiaSvgRenderer
                    layout={{ ...bendLayout, bends: { 'A->B': [0, -60] } }}
                    scene={bendScene}
                    onBendsChange={u => bends.push(u)}
                />
            );

            fireEvent.doubleClick(handleOf(container));

            expect(bends).toEqual([{ 'A->B': null }]);
        });

        // What is drawn a pixel wide cannot be found by a hand, so a band runs along the curve
        // for the pointer to meet. How wide it is drawn is the stylesheet's business
        // (archdia-styles.test.ts); that it is there, and follows the same curve, is this one's.
        it('carries a band along the curve for the pointer to meet', () => {
            const { container } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} onBendsChange={() => { }} />
            );

            expect(container.querySelector('.archdia-relation-hit')!.getAttribute('d'))
                .toBe(container.querySelector('.archdia-relation-line')!.getAttribute('d'));

            // A diagram being read keeps the band — it is what a tooltip is reached by — but its
            // relations are not marked bendable, so nothing lights up over them.
            const { container: readOnly } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} />
            );
            expect(readOnly.querySelector('.archdia-relation-hit')).not.toBeNull();
            expect(readOnly.querySelector('.archdia-relation-bendable')).toBeNull();
            expect(container.querySelector('.archdia-relation-bendable')).not.toBeNull();
        });

        // A press that moved nothing must not write a bend of nought over a straight relation.
        it('leaves a relation alone when its centre is pressed but not moved', () => {
            const bends: Record<string, unknown>[] = [];
            const { container } = render(
                <ArchDiaSvgRenderer layout={bendLayout} scene={bendScene} onBendsChange={u => bends.push(u)} />
            );

            const svg = canvasOf(container);
            fireEvent.mouseDown(handleOf(container), { clientX: 200, clientY: 130 });
            fireEvent.mouseUp(svg);

            expect(bends).toEqual([]);
        });
    });

});
