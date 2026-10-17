import { describe, it, expect } from 'vitest';
import { titleToId, idToTitle, parseTempMd, serializeTempMd } from './template-lang-parser';
import { TemplateCollectionV0 } from './model';

describe('titleToId', () => {
    it('converts multi-word title to camelCase', () => {
        expect(titleToId('Output image format')).toBe('outputImageFormat');
    });

    it('returns single word lowercase', () => {
        expect(titleToId('commit')).toBe('commit');
    });

    it('returns already camelCase as-is', () => {
        expect(titleToId('outputImageFormat')).toBe('outputImageFormat');
    });

    it('handles extra spaces', () => {
        expect(titleToId('  hot   reloading  ')).toBe('hotReloading');
    });
});

describe('idToTitle', () => {
    it('converts camelCase to title', () => {
        expect(idToTitle('outputImageFormat')).toBe('Output image format');
    });

    it('handles single word', () => {
        expect(idToTitle('commit')).toBe('Commit');
    });

    it('handles already uppercase first letter', () => {
        expect(idToTitle('Root')).toBe('Root');
    });
});

describe('parseTempMd', () => {
    it('parses the spec example with code fences', () => {
        const md = `# Prompt

Hello world

## Root

### textTemplate

\`\`\`text
Generate an image of a house in the forest. \${outputImageFormat}
\`\`\`

## Output image format

### defaultText

\`\`\`text
Use any image format that suits you.
\`\`\`

### textTemplate

\`\`\`markdown
Format the image as **png**.
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.name).toBe('Prompt');
        expect(result.index).toBe('Hello world');
        expect(result.rootTemplate.id).toBe('root');
        expect(result.rootTemplate.textTemplate).toBe('Generate an image of a house in the forest. ${outputImageFormat}');
        expect(result.subTemplates).toHaveLength(1);
        expect(result.subTemplates[0].id).toBe('outputImageFormat');
        expect(result.subTemplates[0].defaultText).toBe('Use any image format that suits you.');
        expect(result.subTemplates[0].textTemplate).toBe('Format the image as **png**.');
    });

    it('tolerates different language tags', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`markdown
Hello **world**
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.rootTemplate.textTemplate).toBe('Hello **world**');
    });

    it('tolerates content without code fences (backward compat)', () => {
        const md = `# Test

## Root

### textTemplate

Hello world
`;
        const result = parseTempMd(md);
        expect(result.rootTemplate.textTemplate).toBe('Hello world');
    });

    it('parses template with no sub-templates', () => {
        const md = `# Simple

## Root

### textTemplate

\`\`\`text
Hello world
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.name).toBe('Simple');
        expect(result.index).toBe('');
        expect(result.rootTemplate.textTemplate).toBe('Hello world');
        expect(result.subTemplates).toHaveLength(0);
    });

    it('parses template with empty index', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`text
content
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.index).toBe('');
    });

    it('parses sub-template without defaultText', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`text
\${title}
\`\`\`

## Title

### textTemplate

\`\`\`text
My title
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.subTemplates[0].id).toBe('title');
        expect(result.subTemplates[0].defaultText).toBeUndefined();
        expect(result.subTemplates[0].textTemplate).toBe('My title');
    });

    it('parses sub-template with empty defaultText', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`text
\${title}
\`\`\`

## Title

### defaultText

\`\`\`text

\`\`\`

### textTemplate

\`\`\`text
My title
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.subTemplates[0].defaultText).toBe('');
    });

    it('parses multiline template content', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`text
Line 1
Line 2
Line 3
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.rootTemplate.textTemplate).toBe('Line 1\nLine 2\nLine 3');
    });

    it('parses multiple sub-templates', () => {
        const md = `# Test

## Root

### textTemplate

\`\`\`text
\${title}\${instructions}
\`\`\`

## Title

### textTemplate

\`\`\`text
The title
\`\`\`

## Instructions

### defaultText

\`\`\`text
Default instructions
\`\`\`

### textTemplate

\`\`\`text
Custom instructions
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.subTemplates).toHaveLength(2);
        expect(result.subTemplates[0].id).toBe('title');
        expect(result.subTemplates[1].id).toBe('instructions');
        expect(result.subTemplates[1].defaultText).toBe('Default instructions');
    });
});

describe('serializeTempMd', () => {
    it('serializes with code fences', () => {
        const template: TemplateCollectionV0 = {
            name: 'Prompt',
            index: 'Hello world',
            rootTemplate: { id: 'root', textTemplate: 'Generate an image of a house in the forest. ${outputImageFormat}' },
            subTemplates: [
                { id: 'outputImageFormat', textTemplate: 'Format the image as png.', defaultText: 'Use any image format that suits you.' }
            ]
        };
        const result = serializeTempMd(template);
        expect(result).toBe(`# Prompt

Hello world

## Root

### textTemplate

\`\`\`text
Generate an image of a house in the forest. \${outputImageFormat}
\`\`\`

## Output image format

### defaultText

\`\`\`text
Use any image format that suits you.
\`\`\`

### textTemplate

\`\`\`text
Format the image as png.
\`\`\`
`);
    });

    it('serializes template with no sub-templates', () => {
        const template: TemplateCollectionV0 = {
            name: 'Simple',
            index: '',
            rootTemplate: { id: 'root', textTemplate: 'Hello' },
            subTemplates: []
        };
        const result = serializeTempMd(template);
        expect(result).toBe(`# Simple

## Root

### textTemplate

\`\`\`text
Hello
\`\`\`
`);
    });

    it('omits defaultText section when undefined', () => {
        const template: TemplateCollectionV0 = {
            name: 'Test',
            index: '',
            rootTemplate: { id: 'root', textTemplate: '${title}' },
            subTemplates: [{ id: 'title', textTemplate: 'My title' }]
        };
        const result = serializeTempMd(template);
        expect(result).not.toContain('### defaultText');
    });
});

describe('headings inside code fences', () => {
    it('ignores markdown headings inside template content', () => {
        const md = `# Doc Writer

## Root

### textTemplate

\`\`\`text
Write a document with these sections:
## Introduction
Describe the topic.
## Conclusion
Wrap it up.
\`\`\`

## Footer

### textTemplate

\`\`\`text
### Footnotes
See references.
\`\`\`
`;
        const result = parseTempMd(md);
        expect(result.name).toBe('Doc Writer');
        expect(result.rootTemplate.textTemplate).toBe(
            'Write a document with these sections:\n## Introduction\nDescribe the topic.\n## Conclusion\nWrap it up.'
        );
        expect(result.subTemplates).toHaveLength(1);
        expect(result.subTemplates[0].id).toBe('footer');
        expect(result.subTemplates[0].textTemplate).toBe('### Footnotes\nSee references.');
    });

    it('round-trips content with markdown headings', () => {
        const template: TemplateCollectionV0 = {
            name: 'Markdown Heavy',
            index: '',
            rootTemplate: { id: 'root', textTemplate: '## Title\nSome text\n### Subtitle\nMore text' },
            subTemplates: []
        };
        const serialized = serializeTempMd(template);
        const parsed = parseTempMd(serialized);
        expect(parsed.rootTemplate.textTemplate).toBe(template.rootTemplate.textTemplate);
    });
});

describe('round-trip', () => {
    it('parseTempMd(serializeTempMd(t)) preserves template', () => {
        const template: TemplateCollectionV0 = {
            name: 'Round Trip',
            index: 'Some index text',
            rootTemplate: { id: 'root', textTemplate: '${title}${body}' },
            subTemplates: [
                { id: 'title', textTemplate: 'The title' },
                { id: 'hotReloading', textTemplate: 'Hot reload enabled', defaultText: 'No hot reload' }
            ]
        };
        const serialized = serializeTempMd(template);
        const parsed = parseTempMd(serialized);
        expect(parsed.name).toBe(template.name);
        expect(parsed.index).toBe(template.index);
        expect(parsed.rootTemplate.id).toBe('root');
        expect(parsed.rootTemplate.textTemplate).toBe(template.rootTemplate.textTemplate);
        expect(parsed.subTemplates).toHaveLength(2);
        expect(parsed.subTemplates[0].id).toBe('title');
        expect(parsed.subTemplates[0].textTemplate).toBe('The title');
        expect(parsed.subTemplates[0].defaultText).toBeUndefined();
        expect(parsed.subTemplates[1].id).toBe('hotReloading');
        expect(parsed.subTemplates[1].textTemplate).toBe('Hot reload enabled');
        expect(parsed.subTemplates[1].defaultText).toBe('No hot reload');
    });
});
