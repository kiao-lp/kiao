/**
 * Starter templates for the Insert menu's mermaid diagrams. Each is a complete,
 * renderable example so the preview shows something immediately; the author then
 * edits it in place. Emitted as a fenced ```mermaid block (the language the
 * markdown renderer maps to its <Mermaid> component).
 */
export interface MermaidTemplate {
    key: string;
    label: string;
    /** Mermaid source (without the surrounding code fence). */
    body: string;
}

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
    {
        key: 'flowchart',
        label: 'Flowchart',
        body: [
            'flowchart TD',
            '    A[Start] --> B{Decision}',
            '    B -->|Yes| C[Do the thing]',
            '    B -->|No| D[Skip]',
            '    C --> E[End]',
            '    D --> E',
        ].join('\n'),
    },
    {
        key: 'sequence',
        label: 'Sequence',
        body: [
            'sequenceDiagram',
            '    participant A as Alice',
            '    participant B as Bob',
            '    A->>B: Hello Bob',
            '    B-->>A: Hi Alice',
        ].join('\n'),
    },
    {
        key: 'class',
        label: 'Class',
        body: [
            'classDiagram',
            '    class Animal {',
            '        +String name',
            '        +move() void',
            '    }',
            '    class Dog {',
            '        +bark() void',
            '    }',
            '    Animal <|-- Dog',
        ].join('\n'),
    },
    {
        key: 'state',
        label: 'State',
        body: [
            'stateDiagram-v2',
            '    [*] --> Idle',
            '    Idle --> Running : start',
            '    Running --> Idle : stop',
            '    Running --> [*]',
        ].join('\n'),
    },
    {
        key: 'er',
        label: 'Entity relationship',
        body: [
            'erDiagram',
            '    CUSTOMER ||--o{ ORDER : places',
            '    ORDER ||--|{ LINE_ITEM : contains',
            '    CUSTOMER {',
            '        string name',
            '        string email',
            '    }',
        ].join('\n'),
    },
    {
        key: 'gantt',
        label: 'Gantt',
        body: [
            'gantt',
            '    title Project plan',
            '    dateFormat YYYY-MM-DD',
            '    section Phase 1',
            '    Design   :a1, 2026-01-01, 7d',
            '    Build    :after a1, 10d',
        ].join('\n'),
    },
    {
        key: 'pie',
        label: 'Pie chart',
        body: ['pie title Distribution', '    "A" : 40', '    "B" : 35', '    "C" : 25'].join('\n'),
    },
];

/** Wrap a mermaid template body in a fenced code block. */
export function mermaidBlock(body: string): string {
    return '```mermaid\n' + body + '\n```';
}
