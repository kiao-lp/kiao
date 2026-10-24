# archdia-edit Plugin

The `archdia-edit` plugin renders architecture diagrams as interactive SVG canvases with customizable component layouts within Dashboard.

- **Extension Matcher:** `.arch.md`
- **File Type:** Plain text (Compound format)
- **Primary Mechanism:** Parses a custom text file format containing both the diagram source code (e.g., PlantUML) and a JSON layout object, rendering the extracted components onto an SVG canvas.

## Documentation Index

To support progressive disclosure for both human developers and AI agents, the documentation is split into focused topics:

1. **[Solution design & internals](../../../docs/solution-design/plugins/archdia-edit.md)**: Details the parser, state management (I/O), data models, and the SVG rendering logic.
2. **[Extending with New Languages](../../../docs/solution-design/plugins/archdia-extending.md)**: A guide on how to implement `DiagramSourceExtractor` to support new diagram DSLs (like Mermaid).

## The `.arch.md` File Format

Because the plugin requires both the diagram's source code and its visual layout data, it uses a compound text format separated by `\n---\n`.

### Format Structure

1. **Block 1**: The raw diagram DSL (currently PlantUML).
2. **Separator**: Exactly `\n---\n`.
3. **Block 2**: A JSON object dictating the SVG canvas `size` and component `positions`.

### Example

```text
@startuml
component "Gateway" as GW
rectangle "Catalog" <<service>> as MSCatalog
@enduml
---
{
  "size": { "width": 1200, "height": 800 },
  "positions": {
    "GW": { "x": 100, "y": 100 },
    "MSCatalog": { "x": 350, "y": 100 }
  }
}
```

> [!TIP]
> **Auto-generation:** If an `.arch.md` file is missing the `---` separator and JSON block, the plugin's parser will automatically generate a default grid layout for all extracted components and cleanly save the newly formatted document back to the file system.
