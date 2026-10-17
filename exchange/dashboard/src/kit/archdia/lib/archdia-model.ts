// Layout persists positions only; structure is derived from PlantUML.

/** Leaf canvas position; container bounds are computed from children. */
export interface ComponentPosition {
    x: number;
    y: number;
}

/** Layout keys are element aliases or names; only leaf positions are stored. */
export interface ArchDiaLayout {
    size: { width: number; height: number };
    positions: Record<string, ComponentPosition>;
    /** Centre offsets from the straight relation, keyed from->to, then #2, #3 for duplicates; absent means straight. */
    bends?: Record<string, [number, number]>;
}

/** PlantUML block becomes an SVG layer; element IDs are shared across blocks. */
export interface SourceBlock {
    /** DOM id for the SVG layer. */
    id?: string;
    name?: string;
    source: string;
}

/** Parsed .arch.md: sources define structure; layout defines positions. */
export interface ArchDiaFile {
    sources: SourceBlock[];
    /** Raw markdown; descriptions are extracted on demand. */
    descriptionsRaw?: string;
    layout: ArchDiaLayout;
}

/** Property or method extracted from a class/interface body. */
export interface ClassMember {
    text: string;
    kind: 'property' | 'method';
    /** +public, -private, #protected, ~package. */
    visibility?: '+' | '-' | '#' | '~';
    /** PlantUML {static}. */
    isStatic?: boolean;
    /** PlantUML {abstract}. */
    isAbstract?: boolean;
}

/** Component extracted from diagram source. */
export interface DiagramComponent {
    name: string;
    alias?: string;
    stereotype?: string;
    /** PlantUML keyword; undefined renders as a box. */
    type?: string;
    /** Multiple parents allowed; first is primary for ELK layout. */
    parentIds?: string[];
    members?: ClassMember[];
    /** C4 _Ext: muted, outside the system under design. */
    external?: boolean;
    /** C4 tooltip; a DESCRIPTIONS entry for the same key takes precedence. */
    description?: string;
}

/** Group containing components or other containers. */
export interface DiagramContainer {
    /** Unique id derived from label or generated. */
    id: string;
    label: string;
    stereotype?: string;
    parentId?: string;
    /** C4 tooltip; a DESCRIPTIONS entry for the same id takes precedence. */
    description?: string;
}

/** PlantUML-only layout hint: up opposes reading direction; left/right/none share a rank. */
export type RelationRankHint = 'up' | 'down' | 'left' | 'right' | 'none';

/** Mirror the hint when reading a relation backwards (A <-up- B, Rel_Back_U). */
export const OPPOSITE_RANK_HINT: Record<RelationRankHint, RelationRankHint> = {
    up: 'down', down: 'up', left: 'right', right: 'left', none: 'none',
};

/** Edge between element keys (alias or name). */
export interface DiagramRelation {
    from: string;
    to: string;
    label?: string;
    lineStyle?: 'solid' | 'dashed';
    startArrow?: 'arrow' | 'triangle' | 'diamond' | 'diamond-filled';
    endArrow?: 'arrow' | 'triangle' | 'diamond' | 'diamond-filled';
    /** CSS colour or hex. */
    color?: string;
    weight?: number;
    /** Read only by the PlantUML layout. */
    rankHint?: RelationRankHint;
    /** [[#Key]] in the label references a DESCRIPTIONS section. */
    descriptionRef?: string;
    /** C4 tooltip; a resolved descriptionRef takes precedence. */
    description?: string;
}

/** Runtime structure derived from PlantUML; never persisted. */
export interface DiagramScene {
    components: DiagramComponent[];
    containers: DiagramContainer[];
    relations: DiagramRelation[];
}
