import {
    ClassMember,
    DiagramComponent,
    DiagramContainer,
    DiagramRelation,
    OPPOSITE_RANK_HINT,
    RelationRankHint,
} from './archdia-model';
import {
    C4_BOUNDARY_MACROS,
    extractC4Components,
    extractC4Relations,
    parseC4MacroCall,
} from './c4-source';

// === Diagram Source Extractor Interface ===

/**
 * Abstraction for extracting the full diagram scene from a DSL source.
 * Implement this interface to support a new diagram language (e.g. Mermaid).
 */
export interface DiagramSourceExtractor {
    /** Extract named components from a DSL source string. */
    extractComponents(source: string): DiagramComponent[];
    /** Extract containers (packages/groups) from a DSL source string. */
    extractContainers(source: string): DiagramContainer[];
    /** Extract relations (edges) from a DSL source string. */
    extractRelations(source: string): DiagramRelation[];
}

// === PlantUML Implementation ===

/**
 * Supported PlantUML element keywords for component extraction.
 */
const ELEMENT_KEYWORDS = [
    'component', 'rectangle', 'node', 'class', 'interface', 'database',
    'queue', 'actor', 'entity', 'card', 'frame', 'storage', 'cloud',
    'folder', 'artifact', 'boundary', 'control', 'collections', 'hexagon',
    'enum'
].join('|');

/**
 * Container keywords — elements that group children with `{ ... }`.
 */
const CONTAINER_KEYWORDS = ['package', 'frame', 'folder', 'cloud', 'node', 'rectangle'].join('|');

/**
 * Element keywords whose body `{ ... }` defines class members,
 * NOT a container scope.
 */
const CLASS_BODY_KEYWORDS = new Set(['class', 'interface', 'enum']);

/**
 * Regex patterns for PlantUML element declarations.
 *
 * Matches forms like:
 *   component "Name" as Alias
 *   component "Name" <<stereotype>> as Alias
 *   rectangle Alias
 *   class ClassName { ... }
 *   database "DB Name"
 */
const PLANTUML_ELEMENT_PATTERNS: RegExp[] = [
    // Quoted name with optional stereotype and optional alias:
    new RegExp(
        `^\\s*(?:abstract\\s+)?(${ELEMENT_KEYWORDS})\\s+"([^"]+)"(?:\\s+<<([^>]+)>>)*(?:\\s+as\\s+(\\w+))?`,
        'gmi',
    ),
    // Unquoted name (single word) with optional stereotype, no alias:
    new RegExp(
        `^\\s*(?:abstract\\s+)?(${ELEMENT_KEYWORDS})\\s+(?!(?:as|of|from)\\b)([A-Za-z_]\\w*)(?:\\s+<<([^>]+)>>)*`,
        'gmi',
    ),
];

// === Class Member Parsing ===

/** Separators used in PlantUML class bodies to divide compartments. */
const CLASS_SEPARATOR_PATTERN = /^[.\-=_]{2,}$/;

/**
 * Parse the body of a class/interface declaration to extract ClassMember entries.
 *
 * @param source   Full PlantUML source.
 * @param bodyStartIndex  Character index of the opening `{` of the class body.
 * @returns  Array of ClassMember, or undefined if no body was found.
 */
function parseClassMembers(source: string, bodyStartIndex: number): ClassMember[] | undefined {
    if (bodyStartIndex < 0 || bodyStartIndex >= source.length || source[bodyStartIndex] !== '{') {
        return undefined;
    }

    // Find the matching closing brace
    let depth = 0;
    let bodyEnd = -1;
    for (let i = bodyStartIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) {
                bodyEnd = i;
                break;
            }
        }
    }
    if (bodyEnd === -1) return undefined;

    const bodyText = source.substring(bodyStartIndex + 1, bodyEnd);
    const lines = bodyText.split('\n');
    const members: ClassMember[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (CLASS_SEPARATOR_PATTERN.test(line)) continue;

        let text = line;
        let visibility: ClassMember['visibility'];
        let isStatic = false;
        let isAbstract = false;

        // Extract modifiers like {static} and {abstract}
        if (/\{static\}/i.test(text)) {
            isStatic = true;
            text = text.replace(/\{static\}\s*/i, '').trim();
        }
        if (/\{abstract\}/i.test(text)) {
            isAbstract = true;
            text = text.replace(/\{abstract\}\s*/i, '').trim();
        }

        // Extract visibility prefix
        if (text.length > 0 && '+-#~'.includes(text[0])) {
            visibility = text[0] as ClassMember['visibility'];
            text = text.substring(1).trim();
        }

        if (!text) continue;

        const kind: ClassMember['kind'] = text.includes('(') ? 'method' : 'property';

        members.push({
            text,
            kind,
            ...(visibility ? { visibility } : {}),
            ...(isStatic ? { isStatic } : {}),
            ...(isAbstract ? { isAbstract } : {}),
        });
    }

    return members.length > 0 ? members : undefined;
}

/**
 * For a class/interface declaration at a given character index,
 * find the opening `{` of its body (if any).
 *
 * Handles both inline (`class Foo {`) and next-line (`class Foo\n{`) forms.
 */
function findClassBodyBrace(source: string, matchEnd: number): number {
    // Look ahead from the end of the element-pattern match to find `{`
    // Stop if we hit a newline without finding `{` (or two newlines for next-line style)
    let newlineCount = 0;
    for (let i = matchEnd; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') return i;
        if (ch === '\n') {
            newlineCount++;
            if (newlineCount > 1) break;
        }
        // Stop at any non-whitespace that isn't `{` on the same/next line
        if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') break;
    }
    return -1;
}

// === Container Parsing ===

/**
 * Parse containers (package/frame/folder/etc.) and assign parentId
 * to components discovered within each container scope.
 *
 * Uses brace-depth tracking per container scope to handle nested
 * braces from class/interface bodies correctly.
 */
function parseContainersAndParents(source: string): {
    containers: DiagramContainer[];
    componentParentMap: Map<number, string>; // line index → container id
} {
    const containers: DiagramContainer[] = [];

    // Each entry: { container info, braceDepth within this scope }
    const scopeStack: Array<{ id: string; label: string; parentId?: string; depth: number }> = [];

    const lineContainerMap = new Map<number, string>();

    const containerPattern = new RegExp(
        `^\\s*(?:${CONTAINER_KEYWORDS})\\s+"([^"]+)"(?:\\s+<<([^>]+)>>)*(?:\\s+as\\s+(\\w+))?\\s*\\{`,
        'i',
    );
    const containerUnquotedPattern = new RegExp(
        `^\\s*(?:${CONTAINER_KEYWORDS})\\s+(?!(?:as|of|from)\\b)([A-Za-z_]\\w*)(?:\\s+<<([^>]+)>>)*\\s*\\{`,
        'i',
    );

    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for container opening
        let label: string | undefined;
        let alias: string | undefined;
        let stereotype: string | undefined;
        let description: string | undefined;
        let isContainerOpen = false;

        // C4 boundary macro — `Enterprise_Boundary(alias, "Label") {`
        const macro = parseC4MacroCall(line);
        const boundary = macro && macro.opensScope ? C4_BOUNDARY_MACROS[macro.name] : undefined;

        if (boundary && macro) {
            alias = macro.positional[0];
            label = macro.positional[1] || alias;
            stereotype = boundary.stereotype
                ?? (boundary.stereotypeArgIndex !== undefined
                    ? macro.positional[boundary.stereotypeArgIndex] || undefined
                    : undefined);
            description = boundary.descriptionArgIndex !== undefined
                ? macro.positional[boundary.descriptionArgIndex] || undefined
                : undefined;
            isContainerOpen = Boolean(alias);
        }

        if (!isContainerOpen) {
            // Both patterns capture label, stereotype and alias in that order —
            // the unquoted form simply never has an alias group.
            const match = containerPattern.exec(line) ?? containerUnquotedPattern.exec(line);
            if (match) {
                label = match[1];
                stereotype = match[2]?.trim();
                alias = match[3];
                isContainerOpen = true;
            }
        }

        if (isContainerOpen && label) {
            const id = alias || label;
            const parentId = scopeStack.length > 0
                ? scopeStack[scopeStack.length - 1].id
                : undefined;

            scopeStack.push({ id, label, parentId, depth: 1 });
            containers.push({ id, label, stereotype, parentId, description });

            // Track this line as belonging to the new container
            lineContainerMap.set(i, id);

            // Count any additional braces on this line (after the opening one)
            const afterFirst = line.indexOf('{');
            const rest = line.substring(afterFirst + 1);
            for (const ch of rest) {
                if (ch === '{') scopeStack[scopeStack.length - 1].depth++;
                else if (ch === '}') {
                    scopeStack[scopeStack.length - 1].depth--;
                    if (scopeStack[scopeStack.length - 1].depth === 0) {
                        scopeStack.pop();
                    }
                }
            }
            continue;
        }

        // Track current container for this line
        if (scopeStack.length > 0) {
            lineContainerMap.set(i, scopeStack[scopeStack.length - 1].id);
        }

        // Count braces on non-container lines
        for (const ch of line) {
            if (ch === '{') {
                if (scopeStack.length > 0) {
                    scopeStack[scopeStack.length - 1].depth++;
                }
            } else if (ch === '}') {
                if (scopeStack.length > 0) {
                    scopeStack[scopeStack.length - 1].depth--;
                    if (scopeStack[scopeStack.length - 1].depth === 0) {
                        scopeStack.pop();
                    }
                }
            }
        }
    }

    return { containers, componentParentMap: lineContainerMap };
}

/**
 * Determine which container (if any) a component at a given line belongs to.
 */
function findComponentParent(
    source: string,
    componentMatchIndex: number,
    lineContainerMap: Map<number, string>,
): string | undefined {
    // Convert character index to line number
    const textBefore = source.substring(0, componentMatchIndex);
    const lineNumber = textBefore.split('\n').length - 1;
    return lineContainerMap.get(lineNumber);
}

// === Relation Parsing ===

/**
 * Pattern matching PlantUML relation lines.
 *
 * Matches variations like:
 *   A --> B
 *   A <-- B : label
 *   "Quoted A" --> "Quoted B"
 *   A ..> B : label
 *   A -- B
 *   A *-- B
 *   A o-- B
 *   A <|-- B
 *   FileSet "*" -- "*" File : files   (class-diagram cardinalities)
 */
const RELATION_PATTERN = /^\s*(?:"([^"]+)"|(\w+))(?:\s+"[^"]*")?\s+([<*o|]*[-.]+(?:left|right|up|down|[ludr])?[-.]*(?:\[([^\]]+)\])?[-.]*(?:left|right|up|down|[ludr])?[-.]*[>*o|]*)\s+(?:"[^"]*"\s+)?(?:"([^"]+)"|(\w+))(?:\s+\[\[#([^\]]+)\]\])?(?:\s*:\s*(.+))?$/gmi;

/** Direction words accepted inside an arrow, long and short forms alike. */
const ARROW_DIRECTION_PATTERN = /[-.](left|right|up|down|[ludr])[-.]/i;

const ARROW_DIRECTIONS: Record<string, RelationRankHint> = {
    u: 'up', up: 'up', d: 'down', down: 'down',
    l: 'left', left: 'left', r: 'right', right: 'right',
};

/**
 * The layout hint an arrow carries, read from left to right as it is written:
 * `A -up-> B` asks for B above A, `A -[norank]-> B` for no ranking at all, and
 * a plain `A --> B` for the default — B one rank below A.
 *
 * PlantUML ranks by the order the two elements are *written*, not by where the
 * arrowhead ends up: `A <-- B` still draws A above B, only with the arrow
 * pointing back at it.
 */
function parseWrittenRankHint(arrow: string, style: string | undefined): RelationRankHint {
    if (style?.split(',').some(part => part.trim().toLowerCase() === 'norank')) return 'none';

    // The style block is dropped first: its text is not part of the arrow shape.
    const direction = ARROW_DIRECTION_PATTERN.exec(arrow.replace(/\[[^\]]*\]/g, ''));
    return direction ? ARROW_DIRECTIONS[direction[1].toLowerCase()] : 'down';
}

function parseRelations(source: string): DiagramRelation[] {
    const relations: DiagramRelation[] = [];
    RELATION_PATTERN.lastIndex = 0;
    let match;

    while ((match = RELATION_PATTERN.exec(source)) !== null) {
        // console.log("MATCH:", match[0].trim(), " groups:", match.slice(1));
        const leftName = match[1] || match[2];
        const arrow = match[3];
        const style = match[4];
        const rightName = match[5] || match[6];
        const inlineRef = match[7]?.trim() || undefined; // [[#Key]] after target name
        let rawLabel = match[8]?.trim() || undefined;

        // Extract [[#Key]] description reference — either inline after target or inside the label
        let descriptionRef: string | undefined = inlineRef;
        if (!descriptionRef && rawLabel) {
            const refMatch = rawLabel.match(/\[\[#([^\]]+)\]\]/);
            if (refMatch) {
                descriptionRef = refMatch[1].trim();
                rawLabel = rawLabel.replace(/\[\[#[^\]]+\]\]/, '').trim() || undefined;
            }
        }
        const label = rawLabel;

        if (!leftName || !rightName) continue;

        // Determine line style
        const lineStyle = arrow.includes('.') ? 'dashed' : 'solid';

        // Determine direction from arrow
        const pointsLeft = arrow.startsWith('<') && !arrow.startsWith('<|');
        // For <-- or <|, the target is on the left
        const from = pointsLeft ? rightName : leftName;
        const to = pointsLeft ? leftName : rightName;

        // Parse arrow heads relative to left/right string order
        let leftArrow: DiagramRelation['startArrow'];
        let rightArrow: DiagramRelation['endArrow'];

        if (arrow.startsWith('<|')) leftArrow = 'triangle';
        else if (arrow.startsWith('*')) leftArrow = 'diamond-filled';
        else if (arrow.startsWith('o')) leftArrow = 'diamond';
        else if (arrow.startsWith('<')) leftArrow = 'arrow';

        if (arrow.endsWith('|>')) rightArrow = 'triangle';
        else if (arrow.endsWith('*')) rightArrow = 'diamond-filled';
        else if (arrow.endsWith('o')) rightArrow = 'diamond';
        else if (arrow.endsWith('>')) rightArrow = 'arrow';

        // Parse style block: [#color,thickness=N,bold]
        let color: string | undefined;
        let weight: number | undefined;

        if (style) {
            const parts = style.split(',');
            for (const part of parts) {
                const p = part.trim();
                if (p.startsWith('#') && p.length > 1) {
                    const c = p.substring(1);
                    // If it's 3 or 6 hex digits, keep the '#' for a hex code.
                    // Otherwise, strip it (it's likely a color name like #red).
                    color = /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(c) ? p : c;
                } else if (p.startsWith('thickness=')) {
                    weight = parseFloat(p.substring(10));
                } else if (p === 'bold') {
                    weight = 3;
                }
            }
        }

        // The hint is written left to right; `from` and `to` follow the arrow,
        // so a back-pointing one has them the other way round and mirrors it.
        const written = parseWrittenRankHint(arrow, style);
        const hint = pointsLeft ? OPPOSITE_RANK_HINT[written] : written;

        relations.push({
            from,
            to,
            label,
            lineStyle,
            // `down` is what a relation does by default; only a hint is recorded.
            rankHint: hint === 'down' ? undefined : hint,
            // If the arrow points left, 'from' is rightName and 'to' is leftName.
            // The visual start of the arrow at 'from' (the right) corresponds to rightArrow.
            // The visual end of the arrow at 'to' (the left) corresponds to leftArrow.
            startArrow: pointsLeft ? rightArrow : leftArrow,
            endArrow: pointsLeft ? leftArrow : rightArrow,
            color,
            weight,
            descriptionRef,
        });
    }

    return relations;
}

// === Layout Directives ===

/** The axis a PlantUML diagram is read along: top to bottom, or left to right. */
export type PlantUmlDirection = 'TB' | 'LR';

const DIRECTION_DIRECTIVES: Array<[RegExp, PlantUmlDirection]> = [
    [/^\s*left\s+to\s+right\s+direction\b/i, 'LR'],
    [/^\s*top\s+to\s+bottom\s+direction\b/i, 'TB'],
    [/^\s*LAYOUT_LEFT_RIGHT\s*\(/, 'LR'],
    [/^\s*LAYOUT_TOP_DOWN\s*\(/, 'TB'],
];

/**
 * Which way a source asks to be read.
 *
 * `left to right direction` (and C4's `LAYOUT_LEFT_RIGHT()`) turns PlantUML's
 * ranks into columns, which is the single directive that changes a diagram's
 * shape the most. Top to bottom otherwise, as PlantUML does; the last
 * directive wins, since PlantUML applies them as it reads them.
 */
export function extractPlantUmlDirection(source: string): PlantUmlDirection {
    let direction: PlantUmlDirection = 'TB';

    for (const line of source.split('\n')) {
        if (line.trimStart().startsWith("'")) continue;
        for (const [pattern, value] of DIRECTION_DIRECTIVES) {
            if (pattern.test(line)) direction = value;
        }
    }

    return direction;
}

// === PlantUML Extractor ===

/**
 * Extracts components, containers, and relations from PlantUML source text.
 * Both native PlantUML syntax and C4-PlantUML macros are recognised.
 */
export const plantumlExtractor: DiagramSourceExtractor = {
    extractComponents(source: string): DiagramComponent[] {
        const { containers, componentParentMap } = parseContainersAndParents(source);
        const containerIds = new Set(containers.map(c => c.id));
        const seen = new Map<string, DiagramComponent>();
        const components: DiagramComponent[] = [];

        /**
         * Register a component occurrence. A key declared several times is the
         * same component — extra declarations only contribute their container.
         */
        const addOccurrence = (key: string, parentId: string | undefined, build: () => DiagramComponent) => {
            // Skip if this key represents a container (e.g., a "rectangle" with "{ }")
            if (containerIds.has(key)) return;

            const existing = seen.get(key);
            if (existing) {
                // Component redefined in another container — add to parentIds
                if (parentId && !(existing.parentIds ?? []).includes(parentId)) {
                    (existing.parentIds ??= []).push(parentId);
                }
                return;
            }

            const comp = build();
            comp.parentIds = parentId ? [parentId] : [];
            seen.set(key, comp);
            components.push(comp);
        };

        for (const pattern of PLANTUML_ELEMENT_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const type = match[1]?.toLowerCase();
                const name = match[2];
                const stereotype = match[3]?.trim();
                const alias = match[4] || undefined;
                const matchEnd = match.index + match[0].length;
                const parentId = findComponentParent(source, match.index, componentParentMap);

                addOccurrence(alias || name, parentId, () => {
                    // Extract class/interface body members
                    let members: ClassMember[] | undefined;
                    if (CLASS_BODY_KEYWORDS.has(type)) {
                        const braceIdx = findClassBodyBrace(source, matchEnd);
                        if (braceIdx >= 0) {
                            members = parseClassMembers(source, braceIdx);
                        }
                    }

                    return {
                        name, alias,
                        stereotype: stereotype || (type === 'enum' ? 'enumeration' : undefined),
                        type,
                        members,
                    };
                });
            }
        }

        for (const comp of extractC4Components(source, componentParentMap)) {
            addOccurrence(comp.alias || comp.name, comp.parentIds?.[0], () => comp);
        }

        return components;
    },

    extractContainers(source: string): DiagramContainer[] {
        const { containers } = parseContainersAndParents(source);
        // Deduplicate: when multiple blocks define the same container, keep first
        const seen = new Set<string>();
        return containers.filter(c => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
        });
    },

    extractRelations(source: string): DiagramRelation[] {
        return [...parseRelations(source), ...extractC4Relations(source)];
    },
};
