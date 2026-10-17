# Extending `archdia-edit`

A core architectural goal of this plugin is **format agnosticism**. The rendering engine and the file format parser do not inherently know about PlantUML. They rely on:
- A `DiagramScene` (render model) describing what to draw.
- An `ArchDiaLayout` (storage model) describing where to draw it.

## Adding a New Diagram Language

If you need to add support for a new DSL (such as Mermaid JS architecture diagrams), follow these steps:

### 1. Implement `DiagramSourceExtractor`

Create a new implementation of the `DiagramSourceExtractor` interface in `lib/diagram-source.ts`.

```typescript
import { DiagramSourceExtractor } from './diagram-source';
import { DiagramComponent, DiagramContainer, DiagramRelation } from './archdia-model';

export const mermaidExtractor: DiagramSourceExtractor = {
    extractComponents(source: string): DiagramComponent[] {
        // Extract named nodes → { alias, name, parentId? }
        return [ ... ];
    },
    extractContainers(source: string): DiagramContainer[] {
        // Extract groups/subgraphs → { id, label, parentId? }
        return [ ... ];
    },
    extractRelations(source: string): DiagramRelation[] {
        // Extract edges → { from, to, label? }
        return [ ... ];
    },
};
```

### 2. Update the Hook Strategy

Currently, `hooks/useArchDiaState.ts` hardcodes the use of `plantumlExtractor`. To support multiple formats cleanly:

- Determine the language from the file extension if altered (e.g. `.mermaid.arch.md` vs `.puml.arch.md`), or
- Sniff the first line of the document (e.g., if it starts with `@startuml`, use the `plantumlExtractor`; if it starts with `architecture-beta`, use `mermaidExtractor`).

```typescript
// Example snippet for useArchDiaState.ts:
const isPlantUml = text.trim().startsWith('@startuml');
const extractor = isPlantUml ? plantumlExtractor : mermaidExtractor;

const scene = {
    components: extractor.extractComponents(text),
    containers: extractor.extractContainers(text),
    relations: extractor.extractRelations(text),
};
```

### 3. Add Tests

Always add targeted Regex/parsing tests in `lib/diagram-source.test.ts` to verify the new extractor cleanly handles aliases, containers, relations, varying quotes, and syntax edge cases specific to the new DSL.
