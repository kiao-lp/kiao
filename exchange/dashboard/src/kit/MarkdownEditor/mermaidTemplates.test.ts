import { describe, it, expect } from 'vitest';
import { MERMAID_TEMPLATES, mermaidBlock } from './mermaidTemplates';

describe('mermaidBlock', () => {
    it('wraps a template body in a mermaid code fence', () => {
        expect(mermaidBlock('flowchart TD\n    A --> B')).toBe(
            '```mermaid\nflowchart TD\n    A --> B\n```',
        );
    });
});

describe('MERMAID_TEMPLATES', () => {
    it('has unique keys and non-empty bodies', () => {
        const keys = MERMAID_TEMPLATES.map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const t of MERMAID_TEMPLATES) {
            expect(t.label.trim()).not.toBe('');
            expect(t.body.trim()).not.toBe('');
        }
    });

    it('covers the class and state diagram types', () => {
        const byKey = Object.fromEntries(MERMAID_TEMPLATES.map((t) => [t.key, t.body]));
        expect(byKey.class).toContain('classDiagram');
        expect(byKey.state).toContain('stateDiagram-v2');
    });
});
