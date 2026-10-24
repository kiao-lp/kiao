import { TemplateCollectionV0, TemplateV0 } from './model';

// === ID / Title conversion ===

/**
 * Convert a human-readable title to a camelCase ID.
 * "Output image format" → "outputImageFormat"
 * If already camelCase (no spaces), returns as-is.
 */
export function titleToId(title: string): string {
    const trimmed = title.trim();
    if (!trimmed.includes(' ')) {
        // Single word: lowercase first char (preserves rest for camelCase like "outputImageFormat")
        return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
    }
    const words = trimmed.split(/\s+/);
    return words
        .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
}

/**
 * Convert a camelCase ID to a human-readable title.
 * "outputImageFormat" → "Output image format"
 */
export function idToTitle(id: string): string {
    const words = id.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
    return words
        .map((w, i) => i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())
        .join(' ');
}

// === Code fence helpers ===

const CODE_FENCE_REGEX = /^```\w*\s*\n([\s\S]*?)\n```\s*$/;

/**
 * Strip a markdown code fence wrapper, if present.
 * Tolerates any language tag (```text, ```markdown, etc.).
 */
function unwrapCodeFence(body: string): string {
    const match = body.match(CODE_FENCE_REGEX);
    return match ? match[1] : body;
}

function wrapCodeFence(content: string, lang = 'text'): string {
    return '```' + lang + '\n' + content + '\n```';
}

// === Parser ===

interface Section {
    level: number;
    title: string;
    startIndex: number;
}

/**
 * Build a set of character ranges that fall inside code fences.
 * Used to skip headings that appear inside template content.
 */
function buildFenceRanges(text: string): [number, number][] {
    const ranges: [number, number][] = [];
    const fenceRegex = /^```\w*\s*$/gm;
    let openIndex: number | null = null;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(text)) !== null) {
        if (openIndex === null) {
            openIndex = match.index;
        } else {
            ranges.push([openIndex, match.index + match[0].length]);
            openIndex = null;
        }
    }
    return ranges;
}

function isInsideFence(index: number, ranges: [number, number][]): boolean {
    for (const [start, end] of ranges) {
        if (index >= start && index < end) return true;
        if (index < start) break;
    }
    return false;
}

function findSections(text: string): Section[] {
    const fenceRanges = buildFenceRanges(text);
    const regex = /^(#{1,3})\s+(.+)$/gm;
    const sections: Section[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (isInsideFence(match.index, fenceRanges)) continue;
        sections.push({
            level: match[1].length,
            title: match[2].trim(),
            startIndex: match.index,
        });
    }
    return sections;
}

function extractBody(text: string, section: Section, sections: Section[], sectionIndex: number): string {
    const headingRegex = /^#{1,3}\s+.+$/gm;
    headingRegex.lastIndex = section.startIndex;
    headingRegex.exec(text); // consume the heading itself
    const contentStart = headingRegex.lastIndex;

    let contentEnd = text.length;
    for (let j = sectionIndex + 1; j < sections.length; j++) {
        if (sections[j].level <= section.level) {
            contentEnd = sections[j].startIndex;
            break;
        }
    }

    return unwrapCodeFence(text.substring(contentStart, contentEnd).trim());
}

/**
 * Parse a .temp.md file into a TemplateCollectionV0.
 */
export function parseTempMd(text: string): TemplateCollectionV0 {
    const sections = findSections(text);

    let name = '';
    let index = '';
    let rootTemplate: TemplateV0 = { id: 'root', textTemplate: '' };
    const subTemplates: TemplateV0[] = [];

    // Find the h1 heading (name)
    const h1Index = sections.findIndex(s => s.level === 1);
    if (h1Index >= 0) {
        name = sections[h1Index].title;

        // Index is text between h1 and first h2
        const h1 = sections[h1Index];
        const headingRegex = /^#\s+.+$/gm;
        headingRegex.lastIndex = h1.startIndex;
        headingRegex.exec(text);
        const afterH1 = headingRegex.lastIndex;

        const firstH2 = sections.find(s => s.level === 2);
        const indexEnd = firstH2 ? firstH2.startIndex : text.length;
        index = text.substring(afterH1, indexEnd).trim();
    }

    // Process h2 sections
    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        if (sec.level !== 2) continue;

        // Collect h3 children of this h2
        const variants: Record<string, string> = {};
        for (let j = i + 1; j < sections.length; j++) {
            if (sections[j].level <= 2) break;
            if (sections[j].level === 3) {
                variants[sections[j].title] = extractBody(text, sections[j], sections, j);
            }
        }

        if (sec.title.toLowerCase() === 'root') {
            rootTemplate = {
                id: 'root',
                textTemplate: variants['textTemplate'] ?? '',
            };
        } else {
            const id = titleToId(sec.title);
            const template: TemplateV0 = {
                id,
                textTemplate: variants['textTemplate'] ?? '',
            };
            if ('defaultText' in variants) {
                template.defaultText = variants['defaultText'];
            }
            subTemplates.push(template);
        }
    }

    return { name, index, rootTemplate, subTemplates };
}

// === Serializer ===

/**
 * Serialize a TemplateCollectionV0 to .temp.md format.
 */
export function serializeTempMd(template: TemplateCollectionV0): string {
    const lines: string[] = [];

    // Name
    lines.push(`# ${template.name || ''}`);
    lines.push('');

    // Index
    if (template.index) {
        lines.push(template.index);
        lines.push('');
    }

    // Root template
    lines.push('## Root');
    lines.push('');
    lines.push('### textTemplate');
    lines.push('');
    lines.push(wrapCodeFence(template.rootTemplate.textTemplate));
    lines.push('');

    // Sub-templates
    for (const sub of template.subTemplates) {
        lines.push(`## ${idToTitle(sub.id)}`);
        lines.push('');

        if (sub.defaultText !== undefined && sub.defaultText !== null) {
            lines.push('### defaultText');
            lines.push('');
            lines.push(wrapCodeFence(sub.defaultText));
            lines.push('');
        }

        lines.push('### textTemplate');
        lines.push('');
        lines.push(wrapCodeFence(sub.textTemplate));
        lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
}
