import { ArchDiaFile, ArchDiaLayout, DiagramScene, ComponentPosition, SourceBlock } from './archdia-model';
import { computeElkLayout, computeIncrementalLayout } from './elk-layout';
import { relationKeys } from './relation-geometry';

// === Constants ===

const BLOCK_SEPARATOR = '\n===\n';
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;
const CODE_FENCE_REGEX = /^```\w*\s*\n([\s\S]*?)\n```\s*$/;

// === Block parsing ===

type BlockType = 'PLANTUML' | 'DESCRIPTIONS' | 'LAYOUT';

// === Code fence helpers ===

/**
 * Strip a markdown code fence wrapper from a block body, if present.
 * Accepts bodies like:
 *   ```plantuml
 *   ...content...
 *   ```
 * Returns the inner content, or the original body if no fence is found.
 */
function unwrapCodeFence(body: string): string {
    const match = body.match(CODE_FENCE_REGEX);
    return match ? match[1] : body;
}

/** Map block type → markdown code fence language tag. */
function codeFenceLang(type: BlockType): string {
    switch (type) {
        case 'PLANTUML': return 'plantuml';
        case 'DESCRIPTIONS': return 'markdown';
        case 'LAYOUT': return 'json';
    }
}

interface ParsedBlock {
    type: BlockType;
    id?: string;
    name?: string;
    body: string;
}

/**
 * Parse a single block's frontmatter header and body.
 * Each block starts with a YAML-like frontmatter delimited by "---".
 */
function parseBlock(raw: string): ParsedBlock | undefined {
    const trimmed = raw.trim();
    const match = trimmed.match(FRONTMATTER_REGEX);
    if (!match) return undefined;

    const header = match[1];
    const body = trimmed.slice(match[0].length).trim();

    let type: BlockType | undefined;
    let id: string | undefined;
    let name: string | undefined;

    for (const line of header.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        if (key === 'type') type = value.toUpperCase() as BlockType;
        else if (key === 'id') id = value || undefined;
        else if (key === 'name') name = value || undefined;
    }

    if (!type) return undefined;
    return { type, id, name, body: unwrapCodeFence(body) };
}

/**
 * The bends of two LAYOUT blocks put together, or nothing at all when neither carries any — an
 * empty `bends` in every file that has never had a relation moved would be noise in the diff.
 */
function mergedBends(earlier: ArchDiaLayout, later: ArchDiaLayout): { bends?: ArchDiaLayout['bends'] } {
    if (!earlier.bends && !later.bends) return {};
    return { bends: { ...earlier.bends, ...later.bends } };
}

// === Parser ===

export interface ParseArchDiaOptions {
    width?: number;
    height?: number;
}

/**
 * Parse the raw text of an .arch.md file into its structured representation.
 *
 * Blocks are separated by `\n===\n`. Each block has a frontmatter header
 * specifying its type (PLANTUML, DESCRIPTIONS, or LAYOUT) and optional
 * id/name fields.
 *
 * Multiple blocks of the same type are merged:
 * - PLANTUML blocks are collected into sources[]
 * - DESCRIPTIONS blocks are concatenated
 * - LAYOUT blocks are merged (later overrides earlier)
 *
 * If no LAYOUT block is found, a Sugiyama layout is computed via ELK.
 */
export async function parseArchDiaFile(
    text: string,
    scene: DiagramScene,
    options?: ParseArchDiaOptions
): Promise<ArchDiaFile> {
    const rawBlocks = text.split(BLOCK_SEPARATOR);

    const sources: SourceBlock[] = [];
    const descriptionParts: string[] = [];
    let layout: ArchDiaLayout | undefined;

    for (const raw of rawBlocks) {
        const block = parseBlock(raw);
        if (!block) continue;

        switch (block.type) {
            case 'PLANTUML':
                sources.push({ id: block.id, name: block.name, source: block.body });
                break;
            case 'DESCRIPTIONS':
                if (block.body) descriptionParts.push(block.body);
                break;
            case 'LAYOUT':
                try {
                    const parsed = JSON.parse(block.body) as ArchDiaLayout;
                    layout = layout
                        ? {
                            size: parsed.size ?? layout.size,
                            positions: { ...layout.positions, ...parsed.positions },
                            ...mergedBends(layout, parsed),
                        }
                        : parsed;
                } catch { /* ignore malformed layout */ }
                break;
        }
    }

    if (!layout) {
        layout = await computeElkLayout(scene, options);
    }

    const descriptionsRaw = descriptionParts.length > 0
        ? descriptionParts.join('\n\n')
        : undefined;

    // Ensure every element in the scene has a position entry
    layout = await ensureAllPositions(layout, scene);

    return { sources, descriptionsRaw, layout };
}

/**
 * The PLANTUML blocks of an `.arch.md` text, in source order.
 *
 * The cheap half of `parseArchDiaFile`: no layout is read, reconciled or laid
 * out by ELK, which is what lets a caller ask which diagrams a block holds —
 * and offer them for choosing — without waiting on any of that.
 */
export function parseArchDiaSources(text: string): SourceBlock[] {
    return text
        .split(BLOCK_SEPARATOR)
        .map(parseBlock)
        .filter((block): block is ParsedBlock => block?.type === 'PLANTUML')
        .map(block => ({ id: block.id, name: block.name, source: block.body }));
}

/**
 * Concatenate all PlantUML sources from an ArchDiaFile into a single string.
 * Useful for feeding to the PlantUML extractor which expects a single source.
 */
export function getCombinedSource(file: ArchDiaFile): string {
    return file.sources.map(s => s.source).join('\n\n');
}

// === Serializer ===

function serializeBlockHeader(type: BlockType, id?: string, name?: string): string {
    const lines = ['---'];
    if (id) lines.push(`id: ${id}`);
    lines.push(`type: ${type}`);
    if (name) lines.push(`name: ${name}`);
    lines.push('---');
    return lines.join('\n');
}

export function serializeArchDiaFile(file: ArchDiaFile): string {
    const blocks: string[] = [];

    for (const src of file.sources) {
        blocks.push(serializeBlockHeader('PLANTUML', src.id, src.name) + '\n'
            + wrapCodeFence('PLANTUML', src.source));
    }

    if (file.descriptionsRaw) {
        blocks.push(serializeBlockHeader('DESCRIPTIONS') + '\n'
            + wrapCodeFence('DESCRIPTIONS', file.descriptionsRaw));
    }

    blocks.push(serializeBlockHeader('LAYOUT') + '\n'
        + wrapCodeFence('LAYOUT', JSON.stringify(file.layout, null, 2)));

    return blocks.join(BLOCK_SEPARATOR) + '\n';
}

function wrapCodeFence(type: BlockType, content: string): string {
    return '```' + codeFenceLang(type) + '\n' + content + '\n```';
}

// === Descriptions: on-demand extraction ===

/**
 * Parses all descriptions from a raw markdown string.
 *
 * It iterates over the string once, finding all headings, and assigning all content
 * between that heading and the next heading of **same or higher level** (fewer #'s).
 *
 * @returns A mapping from element key to HTML/markdown string.
 */
export function parseAllDescriptions(raw: string | undefined): Record<string, string> {
    const descriptions: Record<string, string> = {};
    if (!raw) return descriptions;

    const regex = /^(#{1,6})\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    interface SectionInfo {
        key: string;
        level: number;
        startIndex: number;
    }

    const sections: SectionInfo[] = [];

    while ((match = regex.exec(raw)) !== null) {
        sections.push({
            level: match[1].length,
            key: match[2].trim(),
            startIndex: match.index
        });
    }

    if (sections.length === 0) return descriptions;

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        let endIndex = raw.length;

        // The end of this section is the start of the next section with the *same or higher* level (fewer #'s)
        for (let j = i + 1; j < sections.length; j++) {
            if (sections[j].level <= sec.level) {
                endIndex = sections[j].startIndex;
                break;
            }
        }

        // Extract everything after this heading, until endIndex
        const regexRun = /^(#{1,6})\s+(.+)$/gm;
        regexRun.lastIndex = sec.startIndex; // start at our heading
        regexRun.exec(raw); // consume our heading

        const body = raw.substring(regexRun.lastIndex, endIndex).trim();
        if (body) {
            descriptions[sec.key] = body;
        }
    }

    return descriptions;
}

/**
 * Patch a single description entry in raw markdown text.
 * Finds the heading for the given key (any level) and replaces its body,
 * or appends a new ## section if not found.
 * If newBody is undefined, the section is removed.
 */
export function patchDescriptionRaw(
    raw: string,
    key: string,
    newBody: string | undefined
): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headingRegex = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, 'gm');
    const match = headingRegex.exec(raw);

    if (match) {
        const headingStart = match.index;
        const headingLevel = match[1];
        const level = headingLevel.length;

        // Find the next heading of same or higher level (<= number of '#') or end of string
        const afterHeading = headingRegex.lastIndex;
        const nextHeadingRegex = new RegExp(`^#{1,${level}}\\s+`, 'm');
        const nextHeadingMatch = raw.slice(afterHeading).search(nextHeadingRegex);
        const sectionEnd = nextHeadingMatch >= 0 ? afterHeading + nextHeadingMatch : raw.length;

        if (newBody === undefined) {
            const before = raw.substring(0, headingStart).replace(/\n+$/, '');
            const after = raw.substring(sectionEnd).replace(/^\n+/, '');
            return before + (before && after ? '\n\n' : '') + after;
        }

        const newSection = `${headingLevel} ${key}\n\n${newBody.trim()}`;
        const before = raw.substring(0, headingStart);
        const after = raw.substring(sectionEnd).replace(/^\n+/, '');
        return (before + newSection + (after ? '\n\n' + after : '')).trim();
    }

    if (newBody === undefined) return raw;

    return (raw.trimEnd() + `\n\n## ${key}\n\n${newBody.trim()}`).trim();
}

// === Helpers ===

/**
 * The bends of the relations the scene still holds, the rest dropped — a relation taken out of the
 * source leaves nothing behind, exactly as a component taken out leaves no position. The layout's
 * own object is handed back untouched when nothing went, so a caller can tell that by identity.
 */
function prunedBends(layout: ArchDiaLayout, scene: DiagramScene): ArchDiaLayout['bends'] {
    if (!layout.bends) return undefined;

    const live = new Set(relationKeys(scene.relations).values());
    const kept = Object.entries(layout.bends).filter(([key]) => live.has(key));
    if (kept.length === Object.keys(layout.bends).length) return layout.bends;

    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * Ensure every component and container in the scene has a position entry
 * in the layout. Only newly-added elements get a new position via incremental ELK layout.
 */
export async function ensureAllPositions(layout: ArchDiaLayout, scene: DiagramScene): Promise<ArchDiaLayout> {
    // Only components need position entries — container bounds are
    // computed at render time from their children's positions.
    const allKeys: string[] = scene.components.map(c => c.alias || c.name);
    const keySet = new Set(allKeys);

    // Prune stale components (those in layout but not in scene)
    let positions = { ...layout.positions };
    let changed = false;
    for (const key of Object.keys(positions)) {
        if (!keySet.has(key)) {
            delete positions[key];
            changed = true;
        }
    }

    const bends = prunedBends(layout, scene);
    if (bends !== layout.bends) changed = true;

    const newKeys = allKeys.filter(key => !(key in positions));
    if (newKeys.length === 0) {
        return changed ? { ...layout, positions, bends } : layout;
    }

    return { ...await computeIncrementalLayout(scene, { ...layout, positions }, newKeys), bends };
}
