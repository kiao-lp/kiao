import { describe, it, expect } from 'vitest';
import { importAsArchDia, isImportableLanguage, toPlantUmlSource } from './diagram-import';
import { getCombinedSource, parseArchDiaFile } from './archdia-parser';
import { plantumlExtractor } from './diagram-source';

/** Read the imported text back the way the editor will, so the round trip is what is tested. */
const reparse = async (text: string) => {
    const preliminary = await parseArchDiaFile(text, { components: [], containers: [], relations: [] });
    const source = getCombinedSource(preliminary);
    return parseArchDiaFile(text, {
        components: plantumlExtractor.extractComponents(source),
        containers: plantumlExtractor.extractContainers(source),
        relations: plantumlExtractor.extractRelations(source),
    });
};

describe('toPlantUmlSource', () => {
    it('hands a plantuml block back untouched', () => {
        const code = '@startuml\ncomponent A\n@enduml';
        expect(toPlantUmlSource('plantuml', code)).toBe(code);
    });

    it('translates a mermaid block', () => {
        expect(toPlantUmlSource('mermaid', 'flowchart LR\n A[One] --> B[Two]'))
            .toContain('rectangle "One" as A');
    });

    it('refuses a language archdia cannot read', () => {
        expect(() => toPlantUmlSource('js', 'const a = 1;')).toThrow(/cannot be edited as archdia/);
    });

    it('knows which fence languages may be imported', () => {
        expect(['archdia', 'plantuml', 'mermaid'].every(isImportableLanguage)).toBe(true);
        expect(isImportableLanguage('graph')).toBe(false);
    });
});

describe('importAsArchDia', () => {
    it('produces a block that parses back into the same diagram', async () => {
        const text = await importAsArchDia('mermaid', 'flowchart LR\n A[One] --> B[(Two)]');
        const file = await reparse(text);

        expect(file.sources).toHaveLength(1);
        const components = plantumlExtractor.extractComponents(getCombinedSource(file));
        expect(components.map(c => [c.name, c.type])).toEqual([['One', 'rectangle'], ['Two', 'database']]);
    });

    it('lays the diagram out rather than piling it at the origin', async () => {
        const file = await reparse(await importAsArchDia('mermaid', 'flowchart LR\n A --> B --> C'));
        const positions = Object.values(file.layout.positions);

        expect(positions).toHaveLength(3);
        expect(new Set(positions.map(p => `${p.x},${p.y}`)).size).toBe(3);
    });

    it('honours a requested layout size', async () => {
        const file = await reparse(await importAsArchDia('plantuml', 'component A', { width: 640, height: 480 }));

        expect(file.layout.size).toEqual({ width: 640, height: 480 });
    });

    it('wraps a plantuml block without rewriting its source', async () => {
        const code = '@startuml\ncomponent "Alpha" as A\ncomponent "Beta" as B\nA --> B\n@enduml';
        const file = await reparse(await importAsArchDia('plantuml', code));

        expect(file.sources[0].source).toBe(code);
    });
});
