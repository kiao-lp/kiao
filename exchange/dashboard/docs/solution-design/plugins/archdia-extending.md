---
status: DRAFT
role: PRIMARY_SOURCE
---

# Extending `archdia-edit`

Part of the [ArchDia design](archdia-edit.md). Shared engine code lives in
`src/kit/archdia/`; the plugin provides file integration through `@cms-kit/archdia`.

## Adding a New Diagram Language

Prefer conversion into the current PlantUML representation when the language describes
compatible boxes and edges. [mermaid-source.ts](../../../src/kit/archdia/lib/mermaid-source.ts)
and [diagram-import.ts](../../../src/kit/archdia/lib/diagram-import.ts) already import Mermaid
flowcharts and class diagrams. Sequence and Gantt diagrams are rejected because that conversion
would lose their meaning.

### 1. Implement `DiagramSourceExtractor`

Native extraction implements the interface in
[diagram-source.ts](../../../src/kit/archdia/lib/diagram-source.ts):

```ts
interface DiagramSourceExtractor {
    extractComponents(source: string): DiagramComponent[];
    extractContainers(source: string): DiagramContainer[];
    extractRelations(source: string): DiagramRelation[];
}
```

Return stable element keys, container membership and relation endpoints matching those keys.
Keep language-specific parsing in a kit module; rendering consumes `DiagramScene` and layout
without parsing source syntax.

### 2. Update the Hook Strategy

The current wrapper recognizes PLANTUML, DESCRIPTIONS and LAYOUT blocks. The plugin's
[useArchDiaState](../../../src/plugins/archdia-edit/hooks/useArchDiaState.ts) extracts combined
sources with `plantumlExtractor`. Selecting another extractor alone does not add a native
block type: update parser, serializer and every combined-source consumer explicitly.
Do not sniff the first line of the raw file, which is a block header.

For import conversion, extend the converter and import dispatch. The wrapper and PlantUML extractor stay unchanged. Export new public helpers from the kit facade; plugins never import kit internals.

### 3. Add Tests

Place targeted parser/converter tests beside kit code. Cover aliases, quotes, nested containers,
relations, malformed input and unsupported constructs. For a native format change, also verify
multiple blocks, serialization round trips and layout reconciliation without moving existing
leaves. Run the affected Vitest paths; use the repository's verification guide if UI behavior
changes.
