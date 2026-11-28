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

const CODE_FENCE_REGEX = /^(`{3,})[^`\r\n]*\r?\n([\s\S]*?)\r?\n\1`*[ \t]*$/;

/**
 * Strip a markdown code fence wrapper, if present.
 * Tolerates any language tag (```text, ```markdown, etc.).
 */
function unwrapCodeFence(body: string): string {
    const match = body.match(CODE_FENCE_REGEX);
    return match ? match[2] : body;
}

function wrapCodeFence(content: string, lang = 'text'): string {
    let length = 3;
    for (const [ticks] of content.matchAll(/^`{3,}/gm)) {
        length = Math.max(length, ticks.length + 1);
    }
    const fence = '`'.repeat(length);
    return fence + lang + '\n' + content + '\n' + fence;
}

// === Parser ===

interface Section {
    level: number;
    title: string;
    startIndex: number;
    endIndex: number;
}

/**
 * Build a set of character ranges that fall inside code fences.
 * Used to skip headings that appear inside template content.
 */
function buildFenceRanges(text: string): [number, number][] {
    const ranges: [number, number][] = [];
    const fenceRegex = /^(`{3,})([^`\r\n]*)$/gm;
    let open: RegExpMatchArray | undefined;
    for (const match of text.matchAll(fenceRegex)) {
        if (!open) {
            open = match;
        } else if (match[1].length >= open[1].length && !match[2].trim()) {
            ranges.push([open.index!, match.index! + match[0].length]);
            open = undefined;
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
    const regex = /^(#{1,3})[ \t]+(.*)$/gm;
    const sections: Section[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (isInsideFence(match.index, fenceRanges)) continue;
        sections.push({
            level: match[1].length,
            title: match[2].trim(),
            startIndex: match.index,
            endIndex: regex.lastIndex,
        });
    }
    return sections;
}

function extractBody(text: string, section: Section, sections: Section[], sectionIndex: number): string {
    let contentEnd = text.length;
    for (let j = sectionIndex + 1; j < sections.length; j++) {
        if (sections[j].level <= section.level) {
            contentEnd = sections[j].startIndex;
            break;
        }
    }

    return unwrapCodeFence(text.substring(section.endIndex, contentEnd).trim());
}

/**
 * Parse a .temp.md file, or place the original text in Root when the caller is editing
 * a description that does not yet have a Root textTemplate block.
 */
export function parseTempMd(text: string, { fallbackToRoot = false } = {}): TemplateCollectionV0 {
    const sections = findSections(text);
    const name = sections.find(section => section.level === 1)?.title;
    let root: string | undefined;
    const subTemplates: TemplateV0[] = [];

    // Process h2 sections
    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        if (sec.level !== 2) continue;

        // Collect h3 children of this h2
        const variants: Partial<Record<string, string>> = {};
        for (let j = i + 1; j < sections.length; j++) {
            if (sections[j].level <= 2) break;
            if (sections[j].level === 3) {
                variants[sections[j].title] = extractBody(text, sections[j], sections, j);
            }
        }

        if (sec.title.toLowerCase() === 'root') {
            root = variants['textTemplate'];
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

    if (fallbackToRoot && root === undefined) {
        return { rootTemplate: { id: 'root', textTemplate: text }, subTemplates: [] };
    }
    return {
        ...(name ? { name } : {}),
        rootTemplate: { id: 'root', textTemplate: root ?? '' },
        subTemplates,
    };
}

// === Serializer ===

/**
 * Serialize a TemplateCollectionV0 to .temp.md format.
 */
export function serializeTempMd(template: TemplateCollectionV0): string {
    const lines: string[] = [];
    const name = template.name?.trim();
    if (name) lines.push(`# ${name}`, '');

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
