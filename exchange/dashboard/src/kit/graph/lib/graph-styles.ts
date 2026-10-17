/**
 * Graph-specific CSS rules and full style assembly.
 *
 * Builds on shared style builders, adding graph-specific node rendering rules.
 */

import {
    DiagramTheme,
    EDGE_LABEL_FONT_SIZE,
    getCssVarNames,
    buildFullStyleString,
    buildExportStyleString,
    ColorFn,
} from '@cms-kit/diagram-shared';

const PREFIX = 'graph';
export const GRAPH_CSS_VARS = getCssVarNames(PREFIX);

/** Graph-specific diagram rules (beyond what shared provides). */
function graphDiagramRules(c: ColorFn): string {
    return `
/* --- Graph Node value text --- */

.graph-node-value {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: ${EDGE_LABEL_FONT_SIZE}px;
    pointer-events: none;
}

.graph-edge-label {
    fill: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: ${EDGE_LABEL_FONT_SIZE}px;
    pointer-events: none;
}

/* --- Graph description editor input --- */

.graph-description-editor-input {
    width: 100%;
    border: none;
    border-bottom: 1px solid ${c('border')};
    background: transparent;
    color: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
    padding: 2px 0 4px 0;
    margin-bottom: 6px;
    box-sizing: border-box;
}

.graph-description-editor-input::placeholder {
    color: ${c('muted')};
    opacity: 0.7;
}`;
}

/**
 * Returns the full graph CSS string for browser use.
 */
export function getGraphStyleString(themeVars?: Partial<DiagramTheme>): string {
    return buildFullStyleString(PREFIX, GRAPH_CSS_VARS, graphDiagramRules, themeVars);
}

/**
 * Returns flat CSS for SVG export (baked-in colours, no toolbar).
 */
export function getGraphExportStyleString(theme: DiagramTheme): string {
    return buildExportStyleString(PREFIX, theme, graphDiagramRules);
}
