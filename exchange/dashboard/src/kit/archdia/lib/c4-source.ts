/**
 * C4-PlantUML macro support.
 *
 * C4-PlantUML (https://github.com/plantuml-stdlib/C4-PlantUML) is a macro
 * library layered on top of PlantUML: elements are declared with calls like
 * `System(alias, "Label", "Description")` instead of native keywords, so none
 * of the native element/container/relation patterns match them.
 *
 * This module recognises those macro calls and maps them onto the ArchDia
 * scene model:
 *
 *   Person / System / Container / Component  → DiagramComponent
 *   *_Boundary / Node                        → DiagramContainer
 *   Rel / Rel_Back / BiRel                   → DiagramRelation
 *
 * Everything else (`!include`, `LAYOUT_*`, `AddElementTag`, `Lay_*`, …) is
 * ignored: only whitelisted macro names produce scene elements.
 */

import { DiagramComponent, DiagramRelation, OPPOSITE_RANK_HINT, RelationRankHint } from './archdia-model';

// === Macro Tables ===

/** How a C4 element macro maps onto the ArchDia component model. */
export interface C4ElementSpec {
    /** ArchDia element keyword driving the rendered shape. */
    type: string;
    /** True when the third positional argument is a technology rather than a description. */
    hasTechnology: boolean;
    /** True for `_Ext` macros — elements outside the system under design. */
    external: boolean;
}

/**
 * Expand a C4 element family into its shape and external variants:
 * `System`, `SystemDb`, `SystemQueue` and their `_Ext` counterparts.
 */
function elementFamily(base: string, hasTechnology: boolean): Record<string, C4ElementSpec> {
    const shapes: Array<[string, string]> = [['', 'rectangle'], ['Db', 'database'], ['Queue', 'queue']];
    const family: Record<string, C4ElementSpec> = {};

    for (const [suffix, type] of shapes) {
        family[`${base}${suffix}`] = { type, hasTechnology, external: false };
        family[`${base}${suffix}_Ext`] = { type, hasTechnology, external: true };
    }

    return family;
}

/**
 * Element macros, by name.
 *
 * Signatures (optional `$sprite`/`$tags`/`$link` arguments are ignored):
 *   Person(alias, label, descr)
 *   System(alias, label, descr)
 *   Container(alias, label, techn, descr)
 *   Component(alias, label, techn, descr)
 */
export const C4_ELEMENT_MACROS: Record<string, C4ElementSpec> = {
    Person: { type: 'actor', hasTechnology: false, external: false },
    Person_Ext: { type: 'actor', hasTechnology: false, external: true },
    ...elementFamily('System', false),
    ...elementFamily('Container', true),
    ...elementFamily('Component', true),
};

/** How a C4 boundary macro maps onto the ArchDia container model. */
export interface C4BoundarySpec {
    /** Fixed stereotype for boundaries whose type is implied by the macro name. */
    stereotype?: string;
    /** Positional argument holding the boundary type, when the macro takes one. */
    stereotypeArgIndex?: number;
    /** Positional argument holding the description, when the macro takes one. */
    descriptionArgIndex?: number;
}

/**
 * Boundary macros, by name. These open a `{ ... }` scope holding child elements.
 *
 * Signatures:
 *   Boundary(alias, label, type)
 *   Enterprise_Boundary(alias, label) / System_Boundary / Container_Boundary
 *   Node(alias, label, type, descr)   — deployment diagrams
 */
export const C4_BOUNDARY_MACROS: Record<string, C4BoundarySpec> = {
    Boundary: { stereotypeArgIndex: 2 },
    Enterprise_Boundary: { stereotype: 'enterprise' },
    System_Boundary: { stereotype: 'system' },
    Container_Boundary: { stereotype: 'container' },
    Node: { stereotypeArgIndex: 2, descriptionArgIndex: 3 },
    Node_L: { stereotypeArgIndex: 2, descriptionArgIndex: 3 },
    Node_R: { stereotypeArgIndex: 2, descriptionArgIndex: 3 },
    Deployment_Node: { stereotypeArgIndex: 2, descriptionArgIndex: 3 },
};

/** How a C4 relation macro maps onto the ArchDia relation model. */
export interface C4RelationSpec {
    /** True for `Rel_Back*` — the arrow runs from the second element to the first. */
    reverse: boolean;
    /** True for `BiRel*` — arrowheads on both ends. */
    bidirectional: boolean;
    /** Where the suffix asks the second element to sit; absent on the plain macro. */
    rankHint?: RelationRankHint;
}

/**
 * Direction suffixes accepted on relation macros. They are PlantUML layout
 * hints: only the PlantUML layout reads them, every other layout positioning
 * elements on its own terms. `_Neighbor` is C4's `norank` — side by side,
 * neither one below the other.
 */
const RELATION_DIRECTIONS: Array<[string, RelationRankHint]> = [
    ['', 'down'],
    ['_U', 'up'], ['_Up', 'up'],
    ['_D', 'down'], ['_Down', 'down'],
    ['_L', 'left'], ['_Left', 'left'],
    ['_R', 'right'], ['_Right', 'right'],
    ['_Neighbor', 'none'],
];

function relationFamily(base: string, spec: C4RelationSpec): Record<string, C4RelationSpec> {
    const family: Record<string, C4RelationSpec> = {};

    for (const [suffix, written] of RELATION_DIRECTIONS) {
        // The suffix places the second element written; `Rel_Back` swaps which
        // of the two the relation runs from, so the hint mirrors with it —
        // `Rel_Back(a, b)` still asks for a above b, arrow pointing back at it.
        const hint = spec.reverse ? OPPOSITE_RANK_HINT[written] : written;
        family[`${base}${suffix}`] = { ...spec, ...(hint === 'down' ? {} : { rankHint: hint }) };
    }

    return family;
}

/**
 * Relation macros, by name.
 *
 * Signature: `Rel(from, to, label, techn, descr)`.
 * `Lay_*` macros are deliberately absent — they are pure layout hints.
 */
export const C4_REL_MACROS: Record<string, C4RelationSpec> = {
    ...relationFamily('Rel', { reverse: false, bidirectional: false }),
    ...relationFamily('Rel_Back', { reverse: true, bidirectional: false }),
    ...relationFamily('BiRel', { reverse: false, bidirectional: true }),
};

// === Macro Call Parsing ===

/** A parsed C4 macro call found on a single source line. */
export interface C4MacroCall {
    /** Macro name (e.g. `System_Ext`). */
    name: string;
    /** Positional arguments, in order, with surrounding quotes stripped. */
    positional: string[];
    /** Named arguments, keyed without the leading `$` (e.g. `tags`, `lineColor`). */
    named: Record<string, string>;
    /** True when the call is followed by `{` — i.e. it opens a boundary scope. */
    opensScope: boolean;
}

const MACRO_HEAD_PATTERN = /^\s*([A-Za-z_]\w*)\s*\(/;
const NAMED_ARG_PATTERN = /^\$([A-Za-z_]\w*)\s*=\s*([\s\S]*)$/;

/** Strip one layer of surrounding double quotes, if present. */
function unquote(text: string): string {
    const trimmed = text.trim();
    return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed;
}

/**
 * Split a macro argument list on top-level commas.
 * Commas inside double quotes or nested parentheses (e.g. `DashedLine()`)
 * do not separate arguments.
 */
function splitArguments(text: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inQuote = false;

    for (const ch of text) {
        if (inQuote) {
            current += ch;
            if (ch === '"') inQuote = false;
            continue;
        }
        if (ch === '"') {
            inQuote = true;
            current += ch;
        } else if (ch === '(') {
            depth++;
            current += ch;
        } else if (ch === ')') {
            depth--;
            current += ch;
        } else if (ch === ',' && depth === 0) {
            args.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    args.push(current);

    return args;
}

/**
 * Parse a single line as a C4 macro call.
 *
 * PlantUML preprocessor calls always fit on one line, so no continuation
 * handling is needed. Returns undefined when the line is not a macro call.
 */
export function parseC4MacroCall(line: string): C4MacroCall | undefined {
    const head = MACRO_HEAD_PATTERN.exec(line);
    if (!head) return undefined;

    // Find the closing parenthesis of the call, ignoring quoted text
    // and nested calls such as `$lineStyle=DashedLine()`.
    const argsStart = head[0].length;
    let depth = 1;
    let inQuote = false;
    let argsEnd = -1;

    for (let i = argsStart; i < line.length; i++) {
        const ch = line[i];
        if (inQuote) {
            if (ch === '"') inQuote = false;
            continue;
        }
        if (ch === '"') inQuote = true;
        else if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) {
                argsEnd = i;
                break;
            }
        }
    }
    if (argsEnd === -1) return undefined;

    const positional: string[] = [];
    const named: Record<string, string> = {};
    const rawArgs = line.substring(argsStart, argsEnd);

    // An empty argument list yields a single empty chunk — skip it.
    if (rawArgs.trim()) {
        for (const raw of splitArguments(rawArgs)) {
            const namedMatch = NAMED_ARG_PATTERN.exec(raw.trim());
            if (namedMatch) named[namedMatch[1]] = unquote(namedMatch[2]);
            else positional.push(unquote(raw));
        }
    }

    return {
        name: head[1],
        positional,
        named,
        opensScope: line.substring(argsEnd + 1).trim().startsWith('{'),
    };
}

// === Relation Tags ===

/** Relation styling declared by `AddRelTag(...)`. */
export interface C4RelationTagStyle {
    color?: string;
    lineStyle?: 'solid' | 'dashed';
    weight?: number;
}

/** C4 line-style helpers, mapped onto the ArchDia relation model. */
const C4_LINE_STYLES: Record<string, C4RelationTagStyle> = {
    SolidLine: { lineStyle: 'solid' },
    DashedLine: { lineStyle: 'dashed' },
    DottedLine: { lineStyle: 'dashed' },
    BoldLine: { weight: 3 },
};

/**
 * Collect relation styles declared with
 * `AddRelTag("name", $lineColor="#RGB", $lineStyle=DashedLine(), $lineThickness=2)`.
 *
 * Element tags (`AddElementTag`) carry background/border colours that the
 * ArchDia component model has no place for, so they are ignored.
 */
export function parseC4RelationTags(source: string): Map<string, C4RelationTagStyle> {
    const styles = new Map<string, C4RelationTagStyle>();

    for (const line of source.split('\n')) {
        const call = parseC4MacroCall(line);
        if (!call || call.name !== 'AddRelTag') continue;

        const name = call.positional[0];
        if (!name) continue;

        const style: C4RelationTagStyle = {};
        if (call.named.lineColor) style.color = call.named.lineColor;

        const lineStyle = call.named.lineStyle?.replace(/\(\s*\)$/, '').trim();
        if (lineStyle && C4_LINE_STYLES[lineStyle]) Object.assign(style, C4_LINE_STYLES[lineStyle]);

        const thickness = parseFloat(call.named.lineThickness ?? '');
        if (!Number.isNaN(thickness)) style.weight = thickness;

        styles.set(name, style);
    }

    return styles;
}

// === Extraction ===

/**
 * Extract components declared with C4 element macros.
 *
 * Returns one entry per macro call — the same alias may be declared in
 * several boundaries, and the caller merges those occurrences.
 *
 * @param source             Full PlantUML source.
 * @param lineContainerMap   Line index → enclosing container id.
 */
export function extractC4Components(
    source: string,
    lineContainerMap: Map<number, string>,
): DiagramComponent[] {
    const components: DiagramComponent[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const call = parseC4MacroCall(lines[i]);
        if (!call) continue;

        const element = C4_ELEMENT_MACROS[call.name];
        const boundary = C4_BOUNDARY_MACROS[call.name];

        // A boundary macro without `{` declares no scope — render it as a plain box
        // rather than dropping it.
        const isBraceless = Boolean(boundary) && !call.opensScope;
        if (!element && !isBraceless) continue;

        const [alias, label, third, fourth] = call.positional;
        if (!alias) continue;

        // `Container`/`Component`/`Node` take a technology as third argument;
        // `Person`/`System` put the description there instead.
        const hasTechnology = element ? element.hasTechnology : true;
        const technology = hasTechnology ? third : undefined;
        const description = hasTechnology ? fourth : third;
        const parentId = lineContainerMap.get(i);

        components.push({
            name: label || alias,
            alias,
            stereotype: technology || undefined,
            type: element?.type ?? 'rectangle',
            external: element?.external || undefined,
            description: description || undefined,
            parentIds: parentId ? [parentId] : [],
        });
    }

    return components;
}

/**
 * Extract relations declared with C4 relation macros.
 *
 * The technology argument is appended to the label on its own line, matching
 * how C4-PlantUML renders it beneath the relation text.
 */
export function extractC4Relations(source: string): DiagramRelation[] {
    const tagStyles = parseC4RelationTags(source);
    const relations: DiagramRelation[] = [];

    for (const line of source.split('\n')) {
        const call = parseC4MacroCall(line);
        if (!call) continue;

        const spec = C4_REL_MACROS[call.name];
        if (!spec) continue;

        const [from, to, label, technology, description] = call.positional;
        if (!from || !to) continue;

        const labelLines = [label, technology ? `[${technology}]` : undefined].filter(Boolean);
        const tagStyle = call.named.tags
            ? call.named.tags.split(/[\s+]+/).map(tag => tagStyles.get(tag)).find(Boolean)
            : undefined;

        relations.push({
            from: spec.reverse ? to : from,
            to: spec.reverse ? from : to,
            label: labelLines.length > 0 ? labelLines.join('\n') : undefined,
            lineStyle: tagStyle?.lineStyle ?? 'solid',
            startArrow: spec.bidirectional ? 'arrow' : undefined,
            endArrow: 'arrow',
            color: tagStyle?.color,
            weight: tagStyle?.weight,
            rankHint: spec.rankHint,
            description: description || undefined,
        });
    }

    return relations;
}
