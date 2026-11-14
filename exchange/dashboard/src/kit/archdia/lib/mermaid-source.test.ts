import { describe, it, expect } from 'vitest';
import { mermaidToPlantUml, MermaidConversionError } from './mermaid-source';
import { plantumlExtractor } from './diagram-source';

/**
 * The conversion is only worth anything if archdia's own extractor recognises
 * what comes out of it, so most assertions go through `plantumlExtractor` rather
 * than matching the generated text: it is the scene the editor will draw that
 * has to be right, not the exact spelling of the PlantUML.
 */
const sceneOf = (mermaid: string) => {
    const source = mermaidToPlantUml(mermaid);
    return {
        source,
        components: plantumlExtractor.extractComponents(source),
        containers: plantumlExtractor.extractContainers(source),
        relations: plantumlExtractor.extractRelations(source),
    };
};

describe('mermaidToPlantUml — flowcharts', () => {
    it('extracts nodes and edges from a plain flowchart', () => {
        const { components, relations } = sceneOf(`
flowchart TD
    A[Start] --> B[Finish]
`);

        expect(components.map(c => [c.alias, c.name])).toEqual([['A', 'Start'], ['B', 'Finish']]);
        expect(relations).toHaveLength(1);
        expect(relations[0]).toMatchObject({ from: 'A', to: 'B', endArrow: 'arrow', lineStyle: 'solid' });
    });

    it('accepts the `graph` spelling and a one-line body', () => {
        const { components, relations } = sceneOf('graph LR; A-->B');

        expect(components.map(c => c.alias)).toEqual(['A', 'B']);
        expect(relations).toHaveLength(1);
    });

    it('maps node shapes onto the PlantUML keyword that draws them', () => {
        const { components } = sceneOf(`
flowchart LR
    Rect[Rect]
    Store[("Store")]
    Sub[[Sub]]
    Round(Round)
    Stadium([Stadium])
    Circle((Circle))
    Hex{{Hex}}
    Decision{Decision}
    Slanted[/Slanted/]
`);

        expect(Object.fromEntries(components.map(c => [c.alias, c.type]))).toEqual({
            Rect: 'rectangle',
            Store: 'database',
            Sub: 'component',
            Round: 'card',
            Stadium: 'card',
            Circle: 'entity',
            Hex: 'hexagon',
            Decision: 'hexagon',
            Slanted: 'storage',
        });
    });

    it('keeps the label a shape declares, wherever the node is first named', () => {
        const { components } = sceneOf(`
flowchart LR
    A --> B
    B["Named later"]
`);

        expect(components.find(c => c.alias === 'B')?.name).toBe('Named later');
        // A was never given a shape, so its id stands in for the label
        expect(components.find(c => c.alias === 'A')?.name).toBe('A');
    });

    it('reads a label from either link form', () => {
        const { relations } = sceneOf(`
flowchart LR
    A -->|piped| B
    C -- inline --> D
`);

        expect(relations.map(r => r.label)).toEqual(['piped', 'inline']);
    });

    it('turns a line break in a label into the PlantUML escape', () => {
        const { components, relations } = sceneOf(`
flowchart LR
    A["First<br/>Second"] -->|"Up<br>Down"| B
`);

        expect(components[0].name).toBe('First\\nSecond');
        expect(relations[0].label).toBe('Up\\nDown');
    });

    it('carries the line style of dotted and thick links', () => {
        const { relations } = sceneOf(`
flowchart LR
    A -.-> B
    B ==> C
    C --- D
`);

        expect(relations[0]).toMatchObject({ lineStyle: 'dashed', endArrow: 'arrow' });
        expect(relations[1]).toMatchObject({ lineStyle: 'solid', endArrow: 'arrow', weight: 3 });
        expect(relations[2].endArrow).toBeUndefined();
    });

    it('draws a crossed link as a line without an arrowhead', () => {
        const { relations } = sceneOf(`
flowchart LR
    A -.-x|forgotten| B
`);

        expect(relations[0]).toMatchObject({ from: 'A', to: 'B', label: 'forgotten', lineStyle: 'dashed' });
        expect(relations[0].endArrow).toBeUndefined();
    });

    it('arrows both ends of a bidirectional link', () => {
        const { relations } = sceneOf('flowchart LR\n A <--> B');

        expect(relations[0].startArrow).toBe('arrow');
        expect(relations[0].endArrow).toBe('arrow');
    });

    it('expands a chain into one relation per hop', () => {
        const { relations } = sceneOf('flowchart LR\n A --> B --> C');

        expect(relations.map(r => [r.from, r.to])).toEqual([['A', 'B'], ['B', 'C']]);
    });

    it('expands an `&` group into every pairing', () => {
        const { relations } = sceneOf('flowchart LR\n A & B --> C & D');

        expect(relations.map(r => `${r.from}->${r.to}`)).toEqual(['A->C', 'A->D', 'B->C', 'B->D']);
    });

    it('turns a subgraph into a container holding its nodes', () => {
        const { components, containers } = sceneOf(`
flowchart TB
    subgraph ctx["Structured context"]
        direction TB
        A["Goals"]
        B["Constraints"]
    end
    C["Outside"]
`);

        expect(containers).toEqual([{ id: 'ctx', label: 'Structured context', parentId: undefined, stereotype: undefined }]);
        expect(components.find(c => c.alias === 'A')?.parentIds).toEqual(['ctx']);
        expect(components.find(c => c.alias === 'B')?.parentIds).toEqual(['ctx']);
        expect(components.find(c => c.alias === 'C')?.parentIds).toEqual([]);
    });

    it('nests subgraphs', () => {
        const { containers } = sceneOf(`
flowchart TB
    subgraph outer[Outer]
        subgraph inner[Inner]
            A
        end
    end
`);

        expect(containers.map(c => [c.id, c.parentId])).toEqual([['outer', undefined], ['inner', 'outer']]);
    });

    it('places a node in the subgraph that lists it, even when an edge named it first', () => {
        const { components } = sceneOf(`
flowchart TB
    A --> B
    subgraph S[Group]
        B
    end
`);

        expect(components.find(c => c.alias === 'B')?.parentIds).toEqual(['S']);
    });

    it('does not turn a subgraph named by an edge into a second box', () => {
        const { components, containers } = sceneOf(`
flowchart TB
    subgraph ctx[Context]
        A
    end
    ctx --> E[Engine]
`);

        expect(containers.map(c => c.id)).toEqual(['ctx']);
        expect(components.map(c => c.alias)).toEqual(['A', 'E']);
    });

    it('takes a subgraph title as its own id when it has none', () => {
        const { containers } = sceneOf('flowchart TB\n subgraph My Group\n  A\n end');

        expect(containers[0].label).toBe('My Group');
    });

    it('drops styling, comments and init directives', () => {
        const { source, components } = sceneOf(`%%{init: {'theme':'dark'}}%%
flowchart LR
    %% a comment
    A[Kept] --> B[Also kept]
    style A fill:#e74c3c,color:#fff
    classDef big font-size:20px
    linkStyle 0 stroke:red
    click A "https://example.com"
`);

        expect(components.map(c => c.name)).toEqual(['Kept', 'Also kept']);
        expect(source).not.toMatch(/fill:|classDef|linkStyle|click/);
    });

    it('is not derailed by an apostrophe in prose', () => {
        const { components, relations } = sceneOf(`
flowchart LR
    %% Représentation de l'ACL
    A["Contexte d'entrée"] --> B[Suite]
    B --> C[Fin]
`);

        expect(components.map(c => c.name)).toEqual(["Contexte d'entrée", 'Suite', 'Fin']);
        expect(relations).toHaveLength(2);
    });

    it('drops the yaml frontmatter mermaid reads for itself', () => {
        const { components } = sceneOf(`---
title: A title
---
flowchart LR
    A[Only node]
`);

        expect(components.map(c => c.name)).toEqual(['Only node']);
    });

    it('gives a PlantUML alias to an id that is not one', () => {
        const { components, relations } = sceneOf('flowchart LR\n 1st[First] --> node-2[Second]');

        expect(components.map(c => [c.alias, c.name])).toEqual([['n1st', 'First'], ['node_2', 'Second']]);
        expect(relations[0]).toMatchObject({ from: 'n1st', to: 'node_2' });
    });

    it('keeps two ids that sanitize alike apart', () => {
        const { components } = sceneOf('flowchart LR\n a-b[One] --> a_b[Two]');

        expect(components.map(c => [c.alias, c.name])).toEqual([['a_b', 'One'], ['a_b_2', 'Two']]);
    });

    it('surrenders a double quote inside a label rather than break the source', () => {
        const { components } = sceneOf('flowchart LR\n A["He said \\"hi\\""]');

        expect(components[0].name).not.toContain('"');
    });
});

describe('mermaidToPlantUml — class diagrams', () => {
    it('carries class bodies over as members', () => {
        const { components } = sceneOf(`
classDiagram
    class Animal {
        +String name
        +move() void
    }
    class Dog {
        +bark() void
    }
    Animal <|-- Dog
`);

        expect(components.map(c => c.name)).toEqual(['Animal', 'Dog']);
        expect(components[0].members?.map(m => m.text)).toEqual(['String name', 'move() void']);
        expect(components[0].members?.[1].kind).toBe('method');
    });

    it('folds a member declared outside the body into the class', () => {
        const { components } = sceneOf(`
classDiagram
    class Animal
    Animal : +int age
`);

        expect(components[0].members?.map(m => m.text)).toEqual(['int age']);
    });

    it('declares a class that only a relation mentions', () => {
        const { components, relations } = sceneOf('classDiagram\n Animal <|-- Dog');

        expect(components.map(c => c.alias)).toEqual(['Animal', 'Dog']);
        expect(relations[0]).toMatchObject({ from: 'Animal', to: 'Dog' });
    });

    it('keeps relation labels and cardinalities', () => {
        const { relations } = sceneOf('classDiagram\n Order "1" *-- "many" Line : contains');

        expect(relations[0]).toMatchObject({ from: 'Order', to: 'Line', label: 'contains' });
    });

    it('reads an annotation as a stereotype, written either way', () => {
        const { components } = sceneOf(`
classDiagram
    class Shape {
        <<interface>>
        +draw() void
    }
    <<enumeration>> Color
`);

        expect(components.find(c => c.name === 'Shape')?.stereotype).toBe('interface');
        expect(components.find(c => c.name === 'Color')?.stereotype).toBe('enumeration');
    });

    it('turns a namespace into a container', () => {
        const { components, containers } = sceneOf(`
classDiagram
    namespace Shapes {
        class Square
        class Circle
    }
    class Loose
`);

        expect(containers.map(c => c.id)).toEqual(['Shapes']);
        expect(components.find(c => c.name === 'Square')?.parentIds).toEqual(['Shapes']);
        expect(components.find(c => c.name === 'Loose')?.parentIds).toEqual([]);
    });

    it('strips generics, which PlantUML has no place for', () => {
        const { components } = sceneOf('classDiagram\n class Box~T~ {\n  +items List~T~\n }');

        expect(components[0].name).toBe('Box');
        expect(components[0].members?.[0].text).toBe('items List');
    });

    it('renames a class shown under a display name', () => {
        const { components } = sceneOf('classDiagram\n class Sq["Squared shape"]\n Sq <|-- Other');

        expect(components.find(c => c.alias === 'Sq')?.name).toBe('Squared shape');
    });
});

describe('mermaidToPlantUml — what it refuses', () => {
    it('refuses a diagram kind archdia cannot represent', () => {
        expect(() => mermaidToPlantUml('sequenceDiagram\n A->>B: Hello'))
            .toThrow(MermaidConversionError);
        expect(() => mermaidToPlantUml('sequenceDiagram\n A->>B: Hello'))
            .toThrow(/sequenceDiagram/);
    });

    it.each(['gantt\n title Plan', 'pie title Share\n "A" : 40', 'erDiagram\n A ||--o{ B : has'])(
        'refuses %s',
        (source) => {
            expect(() => mermaidToPlantUml(source)).toThrow(MermaidConversionError);
        },
    );

    it('refuses an empty block', () => {
        expect(() => mermaidToPlantUml('   \n  \n')).toThrow(MermaidConversionError);
    });

    it('refuses a flowchart that declares nothing', () => {
        expect(() => mermaidToPlantUml('flowchart LR\n %% nothing here')).toThrow(MermaidConversionError);
    });
});
