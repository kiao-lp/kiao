/**
 * Rewriting a mermaid diagram as PlantUML.
 *
 * archdia speaks one diagram language: its scene extractor, its layout and its
 * editor all read PlantUML. Taking a mermaid diagram in therefore means
 * translating it first, which only makes sense for the mermaid kinds that are
 * made of boxes and edges — `flowchart` / `graph` and `classDiagram`. A sequence
 * diagram or a gantt chart is about lifelines and dates, which the archdia model
 * has nowhere to put, so those are refused rather than flattened into a picture
 * that silently lost half of what it said.
 *
 * The translation is deliberately shallow: it reads declarations, containers and
 * links, and drops everything purely cosmetic (`style`, `classDef`, `linkStyle`,
 * `click`), because archdia colours diagrams from its own theme.
 */

// === Errors ===

/** Raised when the source is a mermaid kind that has no archdia equivalent. */
export class MermaidConversionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MermaidConversionError';
    }
}

// === Intermediate model ===
//
// Both converters build the same shape — elements, containers, relations —
// and share one PlantUML renderer.

interface UmlElement {
    /** PlantUML element keyword (`rectangle`, `database`, `class`, …). */
    keyword: string;
    alias: string;
    label: string;
    stereotype?: string;
    /** Class-body lines, kept verbatim. */
    members?: string[];
    /** Enclosing container alias, if any. */
    container?: string;
}

interface UmlContainer {
    alias: string;
    label: string;
    parent?: string;
}

interface UmlModel {
    elements: Map<string, UmlElement>;
    containers: Map<string, UmlContainer>;
    /** Fully rendered relation lines, in source order. */
    relations: string[];
}

const emptyModel = (): UmlModel => ({ elements: new Map(), containers: new Map(), relations: [] });

// === Shared helpers ===

/** Mermaid ids are looser than PlantUML aliases (`\w+`), so each is mapped once. */
const createAliasTable = () => {
    const byId = new Map<string, string>();
    const used = new Set<string>();

    return (id: string): string => {
        const known = byId.get(id);
        if (known) return known;

        const base = (id.replace(/\W+/g, '_').replace(/^(?=\d)/, 'n') || 'n');
        let alias = base;
        for (let i = 2; used.has(alias); i++) alias = `${base}_${i}`;

        used.add(alias);
        byId.set(id, alias);
        return alias;
    };
};

/**
 * A mermaid label stripped of its quoting and of the markup PlantUML cannot
 * carry. `<br/>` becomes the `\n` PlantUML uses for a line break.
 */
const cleanLabel = (raw: string): string => {
    let text = raw.trim();
    // A markdown string is quoted twice: `"text"`
    for (const quote of ['`', '"']) {
        const unwrapped = new RegExp(`^${quote}([^${quote}]*)${quote}$`).exec(text);
        if (unwrapped) text = unwrapped[1].trim();
    }
    return text
        .replace(/<br\s*\/?>/gi, '\\n')
        .replace(/&nbsp;/gi, ' ')
        .trim();
};

/** PlantUML delimits a name with `"`, so a label carrying one has to give it up. */
const quoteName = (label: string): string => `"${label.replace(/"/g, "'")}"`;

/**
 * Mermaid ends a statement at a newline or a `;` — but a `;` inside a label or a
 * shape body is just text, so bracket depth and quoting are tracked.
 *
 * Only `"` and a backtick open a string: an apostrophe is ordinary prose (`l'ACL`
 * in a comment), and treating it as a delimiter would swallow the rest of the
 * diagram waiting for a partner that never comes.
 */
const splitStatements = (source: string): string[] => {
    const statements: string[] = [];
    let current = '';
    let quote: string | null = null;
    let depth = 0;

    for (const char of source) {
        if (quote) {
            current += char;
            if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === '`') {
            quote = char;
            current += char;
            continue;
        }
        if ('([{'.includes(char)) depth++;
        else if (')]}'.includes(char)) depth = Math.max(0, depth - 1);

        if (char === '\n' || (char === ';' && depth === 0)) {
            statements.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    statements.push(current);

    return statements.map(s => s.trim()).filter(s => s !== '' && !s.startsWith('%%'));
};

// === PlantUML rendering ===

const renderElement = (element: UmlElement, indent: string): string => {
    const stereotype = element.stereotype ? ` <<${element.stereotype}>>` : '';
    const head = `${element.keyword} ${quoteName(element.label)}${stereotype} as ${element.alias}`;
    if (!element.members?.length) return indent + head;

    return [
        `${indent}${head} {`,
        ...element.members.map(member => `${indent}    ${member}`),
        `${indent}}`,
    ].join('\n');
};

/**
 * Declarations first — nested in their containers — then every relation at the
 * top level. Relations do not have to sit inside the package their ends belong
 * to, and hoisting them keeps container membership readable.
 */
const renderPlantUml = (model: UmlModel): string => {
    const lines: string[] = ['@startuml'];

    const renderContainer = (container: UmlContainer, indent: string) => {
        lines.push(`${indent}package ${quoteName(container.label)} as ${container.alias} {`);
        for (const element of model.elements.values()) {
            if (element.container === container.alias) lines.push(renderElement(element, indent + '    '));
        }
        for (const child of model.containers.values()) {
            if (child.parent === container.alias) renderContainer(child, indent + '    ');
        }
        lines.push(`${indent}}`);
    };

    for (const container of model.containers.values()) {
        if (!container.parent) renderContainer(container, '');
    }
    for (const element of model.elements.values()) {
        if (!element.container) lines.push(renderElement(element, ''));
    }
    if (model.relations.length > 0) {
        lines.push('');
        lines.push(...model.relations);
    }

    lines.push('@enduml');
    return lines.join('\n');
};

// === Flowchart: node shapes ===

/**
 * Mermaid shape wrappers mapped to the PlantUML keyword that says the same
 * thing. Several mermaid shapes have no PlantUML counterpart (a rhombus, a
 * trapezoid), so they land on the nearest keyword archdia draws distinctly.
 * Longer openers come first — `[[` has to win over `[`.
 */
const SHAPES: Array<{ open: string; closes: string[]; keyword: string }> = [
    { open: '(((', closes: [')))'], keyword: 'entity' },      // double circle
    { open: '[[', closes: [']]'], keyword: 'component' },     // subroutine
    { open: '[(', closes: [')]'], keyword: 'database' },      // cylinder
    { open: '[/', closes: ['/]', '\\]'], keyword: 'storage' }, // parallelogram / trapezoid
    { open: '[\\', closes: ['\\]', '/]'], keyword: 'storage' },
    { open: '((', closes: ['))'], keyword: 'entity' },        // circle
    { open: '([', closes: ['])'], keyword: 'card' },          // stadium
    { open: '{{', closes: ['}}'], keyword: 'hexagon' },       // hexagon
    { open: '>', closes: [']'], keyword: 'card' },            // asymmetric
    { open: '[', closes: [']'], keyword: 'rectangle' },
    { open: '(', closes: [')'], keyword: 'card' },            // rounded
    { open: '{', closes: ['}'], keyword: 'hexagon' },         // rhombus
];

/**
 * Read the shape wrapper starting at `pos`, if there is one. Quoted stretches
 * are skipped so a delimiter inside a label does not close the shape early.
 */
const readShape = (text: string, pos: number): { label: string; keyword: string; next: number } | null => {
    const shape = SHAPES.find(candidate => text.startsWith(candidate.open, pos));
    if (!shape) return null;

    let i = pos + shape.open.length;
    while (i < text.length) {
        const char = text[i];
        if (char === '"' || char === '`') {
            const end = text.indexOf(char, i + 1);
            if (end < 0) break;
            i = end + 1;
            continue;
        }
        const close = shape.closes.find(candidate => text.startsWith(candidate, i));
        if (close) {
            return {
                label: cleanLabel(text.slice(pos + shape.open.length, i)),
                keyword: shape.keyword,
                next: i + close.length,
            };
        }
        i++;
    }
    return null;
};

// === Flowchart: ids and links ===

/**
 * A mermaid node id. A `-` belongs to the id only when an id character follows
 * it, which keeps `a-1` whole while letting `A-->B` break at the link.
 */
const ID_CHAR = 'A-Za-z0-9_\\u00C0-\\uFFFF';
const NODE_ID = new RegExp(`^[${ID_CHAR}]+(?:-[${ID_CHAR}]+)*`);

type LinkStyle = 'solid' | 'dotted' | 'thick';
type Head = '<' | '>' | 'o' | 'x';

interface FlowLink {
    style: LinkStyle;
    startHead?: Head;
    endHead?: Head;
    label?: string;
    next: number;
}

/** `-- text -->` and friends: a label carried between the two halves of the link. */
const LABELLED_LINKS: Array<{ re: RegExp; style: LinkStyle }> = [
    { re: /^([<xo])?={2,}\s+(.+?)\s+={2,}([>xo])?/, style: 'thick' },
    { re: /^([<xo])?-\.+\s+(.+?)\s+\.+-+([>xo])?/, style: 'dotted' },
    { re: /^([<xo])?-{2,}\s+(.+?)\s+-{2,}([>xo])?/, style: 'solid' },
];

/** `-->`, `-.->`, `==>`, `<-->`, `--x`, … with no label of their own. */
const PLAIN_LINKS: Array<{ re: RegExp; style: LinkStyle }> = [
    { re: /^([<xo])?={2,}([>xo])?/, style: 'thick' },
    { re: /^([<xo])?-\.+-([>xo])?/, style: 'dotted' },
    { re: /^([<xo])?-{2,}([>xo])?/, style: 'solid' },
];

const readLink = (text: string, pos: number): FlowLink | null => {
    const raw = text.slice(pos);
    const rest = raw.replace(/^\s+/, '');
    const offset = pos + (raw.length - rest.length);

    for (const { re, style } of LABELLED_LINKS) {
        const match = re.exec(rest);
        if (match) {
            return {
                style,
                startHead: match[1] as Head | undefined,
                endHead: match[3] as Head | undefined,
                label: cleanLabel(match[2]),
                next: offset + match[0].length,
            };
        }
    }

    for (const { re, style } of PLAIN_LINKS) {
        const match = re.exec(rest);
        if (!match) continue;

        let next = offset + match[0].length;
        // A pipe label follows the link rather than splitting it: `-->|text|`
        const piped = /^\s*\|([^|]*)\|/.exec(text.slice(next));
        const label = piped ? cleanLabel(piped[1]) : undefined;
        if (piped) next += piped[0].length;

        return { style, startHead: match[1] as Head | undefined, endHead: match[2] as Head | undefined, label, next };
    }

    return null;
};

/**
 * The PlantUML arrow for a mermaid link.
 *
 * A mermaid cross end (`--x`) marks a severed connection, so it becomes a line
 * with no head — drawing an arrow there would assert the opposite. A circle end
 * (`--o`) keeps PlantUML's hollow head, the closest thing available.
 */
const renderArrow = (link: FlowLink): string => {
    const head = (mark: Head | undefined, side: 'start' | 'end'): string => {
        if (mark === 'x' || mark === undefined) return '';
        if (mark === 'o') return 'o';
        return side === 'start' ? '<' : '>';
    };

    const body = link.style === 'dotted' ? '..' : link.style === 'thick' ? '-[thickness=3]-' : '--';
    return `${head(link.startHead, 'start')}${body}${head(link.endHead, 'end')}`;
};

// === Flowchart converter ===

const SUBGRAPH_LABEL = /^([^\s[\]"]+)\s*\[\s*([\s\S]*?)\s*\]$/;

/** Statements that only affect appearance or interaction — archdia has no use for them. */
const FLOWCHART_NOISE = /^(style|classDef|class|linkStyle|click|callback|direction|accTitle|accDescr)\b/i;

const convertFlowchart = (statements: string[]): UmlModel => {
    const model = emptyModel();
    const aliasFor = createAliasTable();
    const stack: string[] = [];

    /** Register a mention of a node, letting the first shape and container win. */
    const touchNode = (id: string, shape: { label: string; keyword: string } | null): string => {
        const alias = aliasFor(id);
        // An edge may name a subgraph rather than a node (`ctx --> E`); that is a
        // reference to the container, not a second element sharing its id.
        if (model.containers.has(alias)) return alias;

        const existing = model.elements.get(alias);
        const container = stack[stack.length - 1];

        if (!existing) {
            model.elements.set(alias, {
                keyword: shape?.keyword ?? 'rectangle',
                alias,
                label: shape?.label || id,
                container,
            });
            return alias;
        }

        // A bare reference adds nothing; a shape fills in what was only guessed.
        if (shape) {
            existing.keyword = shape.keyword;
            if (shape.label) existing.label = shape.label;
        }
        // Listing a node inside a subgraph is what puts it there, whichever
        // order the file happens to mention it in.
        if (!existing.container && container) existing.container = container;
        return alias;
    };

    /** Read `A`, `A[Label]`, or a `A & B` group, registering every node it names. */
    const readNodeGroup = (text: string, pos: number): { aliases: string[]; next: number } | null => {
        const aliases: string[] = [];
        let cursor = pos;

        for (;;) {
            const rest = text.slice(cursor).replace(/^\s+/, '');
            const skipped = text.slice(cursor).length - rest.length;
            const id = NODE_ID.exec(rest);
            if (!id) return aliases.length > 0 ? { aliases, next: cursor } : null;

            let next = cursor + skipped + id[0].length;
            const shape = readShape(text, next);
            if (shape) next = shape.next;

            aliases.push(touchNode(id[0], shape));
            cursor = next;

            const ampersand = /^\s*&/.exec(text.slice(cursor));
            if (!ampersand) return { aliases, next: cursor };
            cursor += ampersand[0].length;
        }
    };

    for (const statement of statements) {
        if (/^end\b/i.test(statement)) {
            stack.pop();
            continue;
        }

        const subgraph = /^subgraph\s+(.*)$/i.exec(statement);
        if (subgraph) {
            const header = subgraph[1].trim();
            const labelled = SUBGRAPH_LABEL.exec(header);
            const label = labelled ? cleanLabel(labelled[2]) : cleanLabel(header);
            const alias = aliasFor(labelled ? labelled[1] : label);
            // An edge naming the subgraph may have come first and registered it
            // as a node; the `subgraph` keyword settles what it really is.
            model.elements.delete(alias);
            model.containers.set(alias, { alias, label: label || alias, parent: stack[stack.length - 1] });
            stack.push(alias);
            continue;
        }

        if (FLOWCHART_NOISE.test(statement)) continue;

        let group = readNodeGroup(statement, 0);
        if (!group) continue;

        for (;;) {
            const link = readLink(statement, group.next);
            if (!link) break;

            const target = readNodeGroup(statement, link.next);
            if (!target) break;

            const arrow = renderArrow(link);
            const label = link.label ? ` : ${link.label}` : '';
            for (const from of group.aliases) {
                for (const to of target.aliases) model.relations.push(`${from} ${arrow} ${to}${label}`);
            }
            group = target;
        }
    }

    return model;
};

// === Class diagram converter ===

/** `A "1" *-- "many" B : label` — the arrow reads the same in both languages. */
const CLASS_RELATION = /^([\w~.]+)\s*(?:"([^"]*)")?\s*([<>|*o.-]{2,})\s*(?:"([^"]*)")?\s*([\w~.]+)\s*(?::\s*(.*))?$/;
const CLASS_DECLARATION = /^class\s+([\w~.]+)\s*(?:\[\s*(.*?)\s*\])?\s*(?:~[^~]*~)?\s*(\{)?\s*$/;
const CLASS_MEMBER = /^([\w~.]+)\s*:\s*(.+)$/;
const ANNOTATION = /^<<([^>]+)>>\s*(.*)$/;
const CLASS_NOISE = /^(direction|style|cssClass|click|callback|link|note|accTitle|accDescr)\b/i;

/** Mermaid writes generics as `List~T~`; PlantUML has no place for them. */
const stripGenerics = (name: string): string => name.replace(/~[^~]*~/g, '').trim();

const convertClassDiagram = (statements: string[]): UmlModel => {
    const model = emptyModel();
    const aliasFor = createAliasTable();
    const namespaces: string[] = [];
    let openBody: UmlElement | null = null;

    /** Declare a class on first sight, so a relation alone is enough to draw it. */
    const touchClass = (rawName: string, label?: string): string => {
        const name = stripGenerics(rawName);
        const alias = aliasFor(name);
        if (model.containers.has(alias)) return alias;

        const existing = model.elements.get(alias);

        if (!existing) {
            model.elements.set(alias, {
                keyword: 'class',
                alias,
                label: label || name,
                container: namespaces[namespaces.length - 1],
            });
        } else if (label) {
            existing.label = label;
        }
        return alias;
    };

    /** The class behind a name — `null` when the name turns out to be a namespace. */
    const classNamed = (rawName: string, label?: string): UmlElement | null =>
        model.elements.get(touchClass(rawName, label)) ?? null;

    for (const statement of statements) {
        if (openBody) {
            if (statement.startsWith('}')) {
                openBody = null;
                continue;
            }
            const annotation = ANNOTATION.exec(statement);
            if (annotation) {
                openBody.stereotype = annotation[1].trim();
                continue;
            }
            openBody.members!.push(stripGenerics(statement));
            continue;
        }

        if (statement.startsWith('}')) {
            namespaces.pop();
            continue;
        }

        const namespace = /^namespace\s+([\w.]+)\s*\{?\s*$/i.exec(statement);
        if (namespace) {
            const alias = aliasFor(namespace[1]);
            model.elements.delete(alias);
            model.containers.set(alias, {
                alias,
                label: namespace[1],
                parent: namespaces[namespaces.length - 1],
            });
            namespaces.push(alias);
            continue;
        }

        if (CLASS_NOISE.test(statement)) continue;

        const declaration = CLASS_DECLARATION.exec(statement);
        if (declaration) {
            const element = classNamed(declaration[1], declaration[2] ? cleanLabel(declaration[2]) : undefined);
            if (declaration[3] && element) {
                element.members ??= [];
                openBody = element;
            }
            continue;
        }

        // `<<interface>> Shape` — the standalone form of the annotation
        const annotation = ANNOTATION.exec(statement);
        if (annotation && annotation[2]) {
            const target = classNamed(annotation[2]);
            if (target) target.stereotype = annotation[1].trim();
            continue;
        }

        const relation = CLASS_RELATION.exec(statement);
        if (relation) {
            const from = touchClass(relation[1]);
            const to = touchClass(relation[5]);
            const cardinality = (value: string | undefined) => (value ? ` "${value}"` : '');
            const label = relation[6] ? ` : ${relation[6].trim()}` : '';
            model.relations.push(
                `${from}${cardinality(relation[2])} ${relation[3]}${cardinality(relation[4])} ${to}${label}`,
            );
            continue;
        }

        // `Animal : +int age` — a member declared outside any body
        const member = CLASS_MEMBER.exec(statement);
        if (member) {
            const element = classNamed(member[1]);
            if (element) (element.members ??= []).push(stripGenerics(member[2]));
        }
    }

    return model;
};

// === Entry point ===

/** Mermaid kinds this module knows how to say in PlantUML. */
const CONVERTIBLE: Array<{ re: RegExp; convert: (statements: string[]) => UmlModel }> = [
    { re: /^(flowchart|graph)\b/i, convert: convertFlowchart },
    { re: /^classDiagram(-v2)?\b/i, convert: convertClassDiagram },
];

/**
 * Translate a mermaid diagram into PlantUML.
 *
 * @throws {MermaidConversionError} when the diagram is of a kind archdia cannot
 *   represent, or when nothing recognisable came out of it.
 */
export const mermaidToPlantUml = (source: string): string => {
    // A `---` frontmatter block and `%%{init}%%` directives configure mermaid
    // itself; neither says anything about the diagram's contents.
    const body = source
        .replace(/^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
        .replace(/%%\{[\s\S]*?\}%%/g, '');

    const statements = splitStatements(body);
    if (statements.length === 0) throw new MermaidConversionError('This mermaid block is empty.');

    const kind = CONVERTIBLE.find(candidate => candidate.re.test(statements[0]));
    if (!kind) {
        const name = /^[A-Za-z-]+/.exec(statements[0])?.[0] ?? statements[0];
        throw new MermaidConversionError(
            `A mermaid \`${name}\` diagram has no archdia equivalent — only \`flowchart\` / \`graph\` `
            + 'and `classDiagram` are made of the boxes and edges archdia draws.',
        );
    }

    const model = kind.convert(statements.slice(1));
    if (model.elements.size === 0) {
        throw new MermaidConversionError('No diagram elements were found in this mermaid block.');
    }

    return renderPlantUml(model);
};
