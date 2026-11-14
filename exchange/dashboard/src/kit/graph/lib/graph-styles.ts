/** Graph CSS. Builds on the shared builders. */

import {
    DiagramTheme,
    EDGE_LABEL_FONT_SIZE,
    getCssVarNames,
    buildFullStyleString,
    buildExportStyleString,
    ColorFn,
} from '@kiao-dashboard-kit/diagram-shared';

const PREFIX = 'graph';
export const GRAPH_CSS_VARS = getCssVarNames(PREFIX);

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

export function getGraphStyleString(themeVars?: Partial<DiagramTheme>): string {
    return buildFullStyleString(PREFIX, GRAPH_CSS_VARS, graphDiagramRules, themeVars);
}

/** Baked-in colours, no toolbar. */
export function getGraphExportStyleString(theme: DiagramTheme): string {
    return buildExportStyleString(PREFIX, theme, graphDiagramRules);
}
