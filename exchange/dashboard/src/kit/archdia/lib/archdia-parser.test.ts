import { describe, it, expect } from 'vitest';
import { parseArchDiaFile, parseArchDiaSources, serializeArchDiaFile, getCombinedSource, patchDescriptionRaw, parseAllDescriptions } from './archdia-parser';
import { DiagramScene } from './archdia-model';

const sampleScene: DiagramScene = {
    components: [
        { name: 'Gateway', alias: 'GW', parentIds: ['Operation'] },
        { name: 'Catalog', alias: 'MSCatalog', parentIds: ['Operation'] },
        { name: 'Keycloak', alias: 'MSKeycloak', parentIds: ['Operation'] },
    ],
    containers: [
        { id: 'Operation', label: '🌐 Operation' },
    ],
    relations: [
        { from: 'GW', to: 'MSCatalog' },
        { from: 'GW', to: 'MSKeycloak' },
    ],
};

const sampleSource = `@startuml
component "Gateway" as GW
rectangle "Catalog" <<service>> as MSCatalog
rectangle "Keycloak" <<managed>> as MSKeycloak
@enduml`;

const sampleLayout = {
    size: { width: 1000, height: 500 },
    positions: {
        GW: { x: 100, y: 50 },
        MSCatalog: { x: 300, y: 200 },
        MSKeycloak: { x: 500, y: 200 },
    },
};

const descriptionsMarkdown = `## GW

Gateway is the entrypoint.

## MSCatalog

Catalog service
Handles all requests.`;

// Descriptions using mixed heading levels (h3 and h1 instead of h2)
const mixedHeadingDescriptions = `### GW

Gateway is the entrypoint.

# MSCatalog

Catalog service
Handles all requests.`;

// Helper to build new-format file text
function makeBlock(type: string, body: string, opts?: { id?: string; name?: string }): string {
    const lines = ['---'];
    if (opts?.id) lines.push(`id: ${opts.id}`);
    lines.push(`type: ${type}`);
    if (opts?.name) lines.push(`name: ${opts.name}`);
    lines.push('---');
    return lines.join('\n') + '\n' + body;
}

const fullFileText = [
    makeBlock('PLANTUML', sampleSource),
    makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
].join('\n===\n') + '\n';

const fullFileTextWithDesc = [
    makeBlock('PLANTUML', sampleSource),
    makeBlock('DESCRIPTIONS', descriptionsMarkdown),
    makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
].join('\n===\n') + '\n';

const fullFileTextWithMixedDesc = [
    makeBlock('PLANTUML', sampleSource),
    makeBlock('DESCRIPTIONS', mixedHeadingDescriptions),
    makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
].join('\n===\n') + '\n';

describe('archdia-parser', () => {

    describe('parseArchDiaFile', () => {

        it('parses a complete .arch.md file (source + layout)', async () => {
            const result = await parseArchDiaFile(fullFileText, sampleScene);

            expect(result.sources).toHaveLength(1);
            expect(result.sources[0].source).toBe(sampleSource);
            expect(result.descriptionsRaw).toBeUndefined();
            expect(result.layout.size).toEqual({ width: 1000, height: 500 });
            expect(result.layout.positions['GW']).toEqual({ x: 100, y: 50 });
            expect(result.layout.positions['MSCatalog']).toEqual({ x: 300, y: 200 });
        });

        it('parses a file with descriptions (source + descriptions + layout)', async () => {
            const result = await parseArchDiaFile(fullFileTextWithDesc, sampleScene);

            expect(result.sources).toHaveLength(1);
            expect(result.sources[0].source).toBe(sampleSource);
            expect(result.descriptionsRaw).toBe(descriptionsMarkdown);

            const parsed = parseAllDescriptions(result.descriptionsRaw);
            expect(parsed['GW']).toBe('Gateway is the entrypoint.');
            expect(parsed['MSCatalog']).toBe('Catalog service\nHandles all requests.');

            expect(result.layout.size).toEqual({ width: 1000, height: 500 });
            expect(result.layout.positions['GW']).toEqual({ x: 100, y: 50 });
        });

        it('parses descriptions using any heading level (h1, h3, etc.)', async () => {
            const result = await parseArchDiaFile(fullFileTextWithMixedDesc, sampleScene);

            expect(result.sources[0].source).toBe(sampleSource);
            expect(result.descriptionsRaw).toBe(mixedHeadingDescriptions);

            const parsed = parseAllDescriptions(result.descriptionsRaw);
            expect(parsed['GW']).toBe('Gateway is the entrypoint.');
            expect(parsed['MSCatalog']).toBe('Catalog service\nHandles all requests.');

            expect(result.layout.size).toEqual({ width: 1000, height: 500 });
        });

        it('does not include container positions in persisted layout', async () => {
            const result = await parseArchDiaFile(fullFileText, sampleScene);

            // Containers are computed at render time, not persisted
            expect(result.layout.positions['Operation']).toBeUndefined();
        });

        it('auto-generates layout via ELK when no LAYOUT block is present', async () => {
            const text = makeBlock('PLANTUML', sampleSource);
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.sources[0].source).toBe(sampleSource);
            expect(result.layout.size).toBeDefined();
            expect(result.layout.size.width).toBeGreaterThan(0);
            expect(result.layout.size.height).toBeGreaterThan(0);
            expect(result.layout.positions['GW']).toBeDefined();
            expect(result.layout.positions['MSCatalog']).toBeDefined();
            expect(result.layout.positions['MSKeycloak']).toBeDefined();
            expect(result.layout.positions['Operation']).toBeUndefined();
        });

        it('falls back to ELK layout when LAYOUT JSON is malformed', async () => {
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('LAYOUT', '{ invalid json }'),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.sources[0].source).toBe(sampleSource);
            expect(Object.keys(result.layout.positions).length).toBeGreaterThanOrEqual(3);
        });

        it('adds missing element positions to an existing layout', async () => {
            const partialLayout = {
                size: { width: 800, height: 400 },
                positions: { GW: { x: 10, y: 20 } },
            };
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('LAYOUT', JSON.stringify(partialLayout)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.layout.positions['GW']).toEqual({ x: 10, y: 20 });
            expect(result.layout.positions['MSCatalog']).toBeDefined();
            expect(result.layout.positions['MSKeycloak']).toBeDefined();
            expect(result.layout.positions['Operation']).toBeUndefined();
        });

        it('removes stale component positions that are no longer in the scene', async () => {
            const staleLayout = {
                size: { width: 800, height: 400 },
                positions: {
                    GW: { x: 10, y: 20 },
                    OldComp: { x: 100, y: 100 }
                },
            };
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('LAYOUT', JSON.stringify(staleLayout)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.layout.positions['GW']).toEqual({ x: 10, y: 20 });
            expect(result.layout.positions['OldComp']).toBeUndefined();
            expect(result.layout.positions['MSCatalog']).toBeDefined();
        });

        it('preserves id and name on PLANTUML blocks', async () => {
            const text = makeBlock('PLANTUML', sampleSource, { id: 'arch', name: 'Architecture' });
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.sources[0].id).toBe('arch');
            expect(result.sources[0].name).toBe('Architecture');
        });

        it('supports multiple PLANTUML blocks', async () => {
            const source2 = `@startuml
GW --> MSCatalog : uses
@enduml`;
            const text = [
                makeBlock('PLANTUML', sampleSource, { id: 'structure', name: 'Structure' }),
                makeBlock('PLANTUML', source2, { id: 'flows', name: 'Flows' }),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.sources).toHaveLength(2);
            expect(result.sources[0].id).toBe('structure');
            expect(result.sources[0].source).toBe(sampleSource);
            expect(result.sources[1].id).toBe('flows');
            expect(result.sources[1].source).toBe(source2);
        });

        it('merges multiple DESCRIPTIONS blocks', async () => {
            const desc1 = '## GW\n\nGateway.';
            const desc2 = '## MSCatalog\n\nCatalog.';
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('DESCRIPTIONS', desc1),
                makeBlock('DESCRIPTIONS', desc2),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            const parsed = parseAllDescriptions(result.descriptionsRaw);
            expect(parsed['GW']).toBe('Gateway.');
            expect(parsed['MSCatalog']).toBe('Catalog.');
        });

        it('parses PLANTUML blocks wrapped in code fences', async () => {
            const fencedSource = '```plantuml\n' + sampleSource + '\n```';
            const text = [
                makeBlock('PLANTUML', fencedSource),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.sources[0].source).toBe(sampleSource);
        });

        it('parses DESCRIPTIONS blocks wrapped in code fences', async () => {
            const fencedDesc = '```markdown\n' + descriptionsMarkdown + '\n```';
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('DESCRIPTIONS', fencedDesc),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.descriptionsRaw).toBe(descriptionsMarkdown);
        });

        it('parses LAYOUT blocks wrapped in code fences', async () => {
            const layoutJson = JSON.stringify(sampleLayout, null, 2);
            const fencedLayout = '```json\n' + layoutJson + '\n```';
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('LAYOUT', fencedLayout),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.layout.size).toEqual(sampleLayout.size);
            expect(result.layout.positions['GW']).toEqual(sampleLayout.positions['GW']);
        });

        it('merges multiple LAYOUT blocks (later overrides earlier)', async () => {
            const layout1 = { size: { width: 800, height: 400 }, positions: { GW: { x: 10, y: 20 } } };
            const layout2 = { size: { width: 1000, height: 500 }, positions: { GW: { x: 99, y: 99 } } };
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('LAYOUT', JSON.stringify(layout1)),
                makeBlock('LAYOUT', JSON.stringify(layout2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);

            expect(result.layout.positions['GW']).toEqual({ x: 99, y: 99 });
            expect(result.layout.size).toEqual({ width: 1000, height: 500 });
        });
    });

    describe('parseArchDiaSources', () => {

        it('lists the diagrams a file holds, with what names them', () => {
            const text = [
                makeBlock('PLANTUML', sampleSource, { id: 'layer1', name: 'Overview' }),
                makeBlock('PLANTUML', 'GW --> MSCatalog'),
                makeBlock('DESCRIPTIONS', descriptionsMarkdown),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n') + '\n';

            expect(parseArchDiaSources(text)).toEqual([
                { id: 'layer1', name: 'Overview', source: sampleSource },
                { id: undefined, name: undefined, source: 'GW --> MSCatalog' },
            ]);
        });

        it('agrees with the sources the full parse finds', async () => {
            const parsed = await parseArchDiaFile(fullFileTextWithDesc, sampleScene);
            expect(parseArchDiaSources(fullFileTextWithDesc)).toEqual(parsed.sources);
        });

        it('finds nothing in a body that is not an archdia file', () => {
            expect(parseArchDiaSources('flowchart LR\n A --> B')).toEqual([]);
        });
    });

    describe('getCombinedSource', () => {

        it('concatenates all sources', async () => {
            const result = await parseArchDiaFile(fullFileText, sampleScene);
            const combined = getCombinedSource(result);
            expect(combined).toBe(sampleSource);
        });

        it('joins multiple sources with double newline', async () => {
            const source2 = 'GW --> MSCatalog';
            const text = [
                makeBlock('PLANTUML', sampleSource),
                makeBlock('PLANTUML', source2),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');
            const result = await parseArchDiaFile(text, sampleScene);
            expect(getCombinedSource(result)).toBe(`${sampleSource}\n\n${source2}`);
        });
    });

    describe('serializeArchDiaFile', () => {

        it('serializes to the expected block format with code fences', () => {
            const file = { sources: [{ source: sampleSource }], layout: sampleLayout };
            const text = serializeArchDiaFile(file);

            expect(text).toContain(sampleSource);
            expect(text).toContain('\n===\n');
            expect(text).toContain('type: PLANTUML');
            expect(text).toContain('type: LAYOUT');
            expect(text).toContain('"MSCatalog"');
            // Code fences are added on save
            expect(text).toContain('```plantuml\n');
            expect(text).toContain('```json\n');
        });

        it('serializes source blocks with id and name', () => {
            const file = {
                sources: [{ id: 'arch', name: 'Architecture', source: sampleSource }],
                layout: sampleLayout,
            };
            const text = serializeArchDiaFile(file);

            expect(text).toContain('id: arch');
            expect(text).toContain('name: Architecture');
            expect(text).toContain('type: PLANTUML');
        });

        it('wraps descriptions in markdown code fence on serialize', () => {
            const file = {
                sources: [{ source: sampleSource }],
                descriptionsRaw: descriptionsMarkdown,
                layout: sampleLayout,
            };
            const text = serializeArchDiaFile(file);

            expect(text).toContain('```markdown\n');
            expect(text).toContain(descriptionsMarkdown);
        });

        it('adds code fences on save even when input had none', async () => {
            // Input without fences
            const first = await parseArchDiaFile(fullFileText, sampleScene);
            const serialized = serializeArchDiaFile(first);

            expect(serialized).toContain('```plantuml\n');
            expect(serialized).toContain('```json\n');
        });

        it('round-trips parse → serialize → parse', async () => {
            const first = await parseArchDiaFile(fullFileText, sampleScene);
            const serialized = serializeArchDiaFile(first);
            const second = await parseArchDiaFile(serialized, sampleScene);

            expect(second.sources[0].source).toBe(first.sources[0].source);
            expect(second.descriptionsRaw).toBeUndefined();
            expect(second.layout.size).toEqual(first.layout.size);
            expect(second.layout.positions).toEqual(first.layout.positions);
        });

        it('round-trips parse → serialize → parse with descriptions', async () => {
            const first = await parseArchDiaFile(fullFileTextWithDesc, sampleScene);
            const serialized = serializeArchDiaFile(first);
            const second = await parseArchDiaFile(serialized, sampleScene);

            expect(second.sources[0].source).toBe(first.sources[0].source);
            expect(second.descriptionsRaw).toBe(first.descriptionsRaw);

            const parsed = parseAllDescriptions(second.descriptionsRaw);
            expect(parsed['GW']).toBe('Gateway is the entrypoint.');
            expect(parsed['MSCatalog']).toBe('Catalog service\nHandles all requests.');

            expect(second.layout.size).toEqual(first.layout.size);
            expect(second.layout.positions).toEqual(first.layout.positions);
        });

        it('round-trips preserve heading levels in descriptions', async () => {
            const first = await parseArchDiaFile(fullFileTextWithMixedDesc, sampleScene);
            const serialized = serializeArchDiaFile(first);

            expect(serialized).toContain('### GW');
            expect(serialized).toContain('# MSCatalog');
            expect(serialized).not.toMatch(/^## GW$/m);
            expect(serialized).not.toMatch(/^## MSCatalog$/m);

            const second = await parseArchDiaFile(serialized, sampleScene);
            expect(second.descriptionsRaw).toBe(first.descriptionsRaw);
        });

        it('round-trips multiple PLANTUML blocks with ids', async () => {
            const source2 = `@startuml
GW --> MSCatalog : uses
@enduml`;
            const text = [
                makeBlock('PLANTUML', sampleSource, { id: 'structure' }),
                makeBlock('PLANTUML', source2, { id: 'flows' }),
                makeBlock('LAYOUT', JSON.stringify(sampleLayout, null, 2)),
            ].join('\n===\n');

            const first = await parseArchDiaFile(text, sampleScene);
            const serialized = serializeArchDiaFile(first);
            const second = await parseArchDiaFile(serialized, sampleScene);

            expect(second.sources).toHaveLength(2);
            expect(second.sources[0].id).toBe('structure');
            expect(second.sources[0].source).toBe(sampleSource);
            expect(second.sources[1].id).toBe('flows');
            expect(second.sources[1].source).toBe(source2);
        });
    });


    describe('relation bends', () => {

        const withLayout = (layout: unknown) => `---
type: PLANTUML
---
${sampleSource}
===
---
type: LAYOUT
---
\`\`\`json
${JSON.stringify(layout, null, 2)}
\`\`\`
`;

        it('reads back the centres a diagram\'s relations were given', async () => {
            const bends = { 'GW->MSCatalog': [0, -40] };
            const file = await parseArchDiaFile(withLayout({ ...sampleLayout, bends }), sampleScene);

            expect(file.layout.bends).toEqual(bends);
            expect(serializeArchDiaFile(file)).toContain('"GW->MSCatalog"');
        });

        // A relation taken out of the source leaves nothing behind, as a component does not.
        it('drops the bends of relations the source no longer holds', async () => {
            const bends = { 'GW->MSCatalog': [0, -40], 'GW->Gone': [10, 10] };
            const file = await parseArchDiaFile(withLayout({ ...sampleLayout, bends }), sampleScene);

            expect(file.layout.bends).toEqual({ 'GW->MSCatalog': [0, -40] });
        });

        it('leaves no trace in a file whose relations all run straight', async () => {
            const file = await parseArchDiaFile(withLayout(sampleLayout), sampleScene);

            expect(serializeArchDiaFile(file)).not.toContain('bends');
        });

        it('merges the bends of several LAYOUT blocks, the later ones winning', async () => {
            const text = withLayout({ ...sampleLayout, bends: { 'GW->MSCatalog': [0, -40] } })
                + `===
---
type: LAYOUT
---
\`\`\`json
${JSON.stringify({ bends: { 'GW->MSKeycloak': [20, 0], 'GW->MSCatalog': [0, 80] } })}
\`\`\`
`;
            const file = await parseArchDiaFile(text, sampleScene);

            expect(file.layout.bends).toEqual({ 'GW->MSCatalog': [0, 80], 'GW->MSKeycloak': [20, 0] });
        });
    });

    describe('parseAllDescriptions', () => {

        it('extracts a flat description by element key', () => {
            const raw = '## GW\n\nGateway is the entrypoint.\n\n## MSCatalog\n\nCatalog service.';
            const parsed = parseAllDescriptions(raw);
            expect(parsed['GW']).toBe('Gateway is the entrypoint.');
            expect(parsed['MSCatalog']).toBe('Catalog service.');
        });

        it('returns undefined for unknown keys', () => {
            const raw = '## GW\n\nGateway.';
            const parsed = parseAllDescriptions(raw);
            expect(parsed['Unknown']).toBeUndefined();
        });

        it('returns empty objects for undefined/empty raw', () => {
            expect(Object.keys(parseAllDescriptions(undefined)).length).toBe(0);
            expect(Object.keys(parseAllDescriptions('')).length).toBe(0);
        });

        it('includes sub-headings in the description (hierarchical)', () => {
            const raw = '# Dashboard\n\n## Description\n\nWeb-based file manager.\n\n# AnotherService\n\nSome text.';
            const parsed = parseAllDescriptions(raw);
            expect(parsed['Dashboard']).toBe('## Description\n\nWeb-based file manager.');
            expect(parsed['AnotherService']).toBe('Some text.');
        });

        it('stops at same-level heading but includes deeper headings', () => {
            const raw = '## A\n\n### Details\n\nSome details.\n\n## B\n\nB text.';
            const parsed = parseAllDescriptions(raw);
            expect(parsed['A']).toBe('### Details\n\nSome details.');
            expect(parsed['B']).toBe('B text.');
        });

        it('works with mixed heading levels', () => {
            const raw = '### GW\n\nGateway.\n\n# MSCatalog\n\nCatalog.';
            const parsed = parseAllDescriptions(raw);
            expect(parsed['GW']).toBe('Gateway.');
            expect(parsed['MSCatalog']).toBe('Catalog.');
        });
    });

    describe('patchDescriptionRaw', () => {

        it('replaces an existing section body preserving heading level and keeping child headings (bug fix)', () => {
            const raw = '## GW\n\nOld description.\n### SubComp\n\nDetails.\n\n## MSCatalog\n\nCatalog text.';
            const result = patchDescriptionRaw(raw, 'GW', 'New description.\n### SubComp\n\nNew details.');
            expect(result).toContain('## GW\n\nNew description.\n### SubComp\n\nNew details.');
            expect(result).toContain('## MSCatalog\n\nCatalog text.');
        });

        it('appends a new section with ## when key not found', () => {
            const raw = '### GW\n\nGateway.';
            const result = patchDescriptionRaw(raw, 'NewComp', 'New component.');
            expect(result).toContain('### GW\n\nGateway.');
            expect(result).toContain('## NewComp\n\nNew component.');
        });

        it('removes a section when newBody is undefined', () => {
            const raw = '### GW\n\nGateway.\n\n# MSCatalog\n\nCatalog.';
            const result = patchDescriptionRaw(raw, 'GW', undefined);
            expect(result).not.toContain('GW');
            expect(result).toContain('# MSCatalog\n\nCatalog.');
        });

        it('returns raw unchanged when removing a non-existent key', () => {
            const raw = '### GW\n\nGateway.';
            const result = patchDescriptionRaw(raw, 'Missing', undefined);
            expect(result).toBe(raw);
        });
    });
});
