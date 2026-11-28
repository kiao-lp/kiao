/** CSS rule builders by class-name prefix. Each diagram package passes its own prefix. */

import { DiagramTheme, CssVarNames, THEME_DARK, THEME_LIGHT, themeToCssVars } from './theme';

export type ColorFn = (key: keyof DiagramTheme) => string;

// Node rules.

export function buildNodeBaseRules(p: string, c: ColorFn): string {
    return `
.${p}-svg {
    background-color: ${c('bg')};
}

.${p}-node-box {
    fill: ${c('accentBg')};
    stroke: ${c('boxBorder')};
    stroke-width: 1.5;
}

.${p}-node-label {
    fill: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    pointer-events: none;
}

.${p}-node-subtitle {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    pointer-events: none;
}`;
}

// Edge rules.

export function buildEdgeRules(p: string, c: ColorFn): string {
    return `
.${p}-edge-line {
    stroke: ${c('muted')};
    stroke-width: 1.2;
}

.${p}-edge-label {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    pointer-events: none;
}

.${p}-arrowhead {
    fill: ${c('muted')};
    color: ${c('muted')};
}`;
}

// Drag rules.

export function buildDragRules(p: string): string {
    return `
.${p}-draggable {
    cursor: grab;
}

.${p}-dragging .${p}-draggable {
    cursor: grabbing;
}

.${p}-dragging {
    user-select: none;
}`;
}

// Tooltip rules.

export function buildTooltipRules(p: string, c: ColorFn): string {
    return `
.${p}-tooltip {
    pointer-events: none;
}

.${p}-tooltip-body {
    width: max-content;
    max-width: 300px;
    max-height: 400px;
    overflow: auto;
    padding: 10px 14px;
    background: ${c('bg')};
    border: 1px solid ${c('border')};
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: ${c('text')};
    box-sizing: border-box;
    white-space: normal;
}

.${p}-tooltip-body p { margin: 0 0 8px 0; }
.${p}-tooltip-body p:last-child { margin-bottom: 0; }
.${p}-tooltip-body h1, .${p}-tooltip-body h2,
.${p}-tooltip-body h3, .${p}-tooltip-body h4,
.${p}-tooltip-body h5, .${p}-tooltip-body h6 {
    margin: 0 0 6px 0;
    font-size: 14px;
    font-weight: 600;
    color: ${c('text')};
}
.${p}-tooltip-body ul, .${p}-tooltip-body ol { margin: 0 0 8px 0; padding-left: 20px; }
.${p}-tooltip-body li { margin-bottom: 2px; }
.${p}-tooltip-body code {
    background: ${c('accentBg')};
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
}
.${p}-tooltip-body strong { font-weight: 600; }
.${p}-tooltip-body a { color: ${c('link')}; text-decoration: none; }

.${p}-inline-tooltip {
    display: none;
    pointer-events: none;
}`;
}

// Description editor rules.

export function buildDescriptionEditorRules(p: string, c: ColorFn): string {
    return `
.${p}-editable {
    cursor: text;
}

.${p}-description-editor-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 8px;
    background: rgba(20, 24, 36, 0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid ${c('border')};
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
}

.${p}-description-editor-textarea {
    flex: 1;
    width: 100%;
    resize: none;
    border: none;
    background: transparent;
    color: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
}

.${p}-description-editor-textarea::placeholder {
    color: ${c('muted')};
    opacity: 0.7;
}`;
}

// Canvas rules.

export function buildCanvasRules(p: string): string {
    return `
.${p}-canvas {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
    overflow: auto;
    padding: 16px;
    box-sizing: border-box;
    --checker-color: #181818;
    --checker-bg: #111;
    background-color: var(--checker-bg);
    background-image: conic-gradient(var(--checker-color) 25%, transparent 0 50%, var(--checker-color) 0 75%, transparent 0);
    background-size: 20px 20px;
}

.${p}-theme-light .${p}-canvas {
    --checker-color: #e0e0e0;
    --checker-bg: #fff;
}

.${p}-code-editor {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: hidden;
}`;
}

// Full style string.

/** `extraDiagram` adds package rules. `themeOverrides` overrides the dark theme. */
export function buildFullStyleString(
    prefix: string,
    cssVars: CssVarNames,
    extraDiagram?: (c: ColorFn) => string,
    themeOverrides?: Partial<DiagramTheme>,
): string {
    const theme = { ...THEME_DARK, ...themeOverrides };

    const rootVarsStr = Object.entries(themeToCssVars(cssVars, theme))
        .map(([k, v]) => `    ${k}: ${v};`)
        .join('\n');

    const lightVarsStr = Object.entries(themeToCssVars(cssVars, THEME_LIGHT))
        .map(([k, v]) => `    ${k}: ${v};`)
        .join('\n');

    const c: ColorFn = (key) => `var(${cssVars[key]}, ${theme[key]})`;

    return `
/* Default Theme (Dark) */
.${prefix}-canvas, .${prefix}-svg {
${rootVarsStr}
}

.${prefix}-theme-light,
.${prefix}-theme-light .${prefix}-canvas,
.${prefix}-theme-light .${prefix}-svg,
.${prefix}-canvas.${prefix}-theme-light,
.${prefix}-svg.${prefix}-theme-light {
${lightVarsStr}
}
${buildNodeBaseRules(prefix, c)}
${buildEdgeRules(prefix, c)}
${buildDragRules(prefix)}
${buildTooltipRules(prefix, c)}
${buildDescriptionEditorRules(prefix, c)}
${extraDiagram ? extraDiagram(c) : ''}

.${prefix}-inline-tooltip {
    display: none;
}
${buildCanvasRules(prefix)}
`;
}

/** Export CSS: baked-in colours, no toolbar or canvas rules. */
export function buildExportStyleString(
    prefix: string,
    theme: DiagramTheme,
    extraDiagram?: (c: ColorFn) => string,
): string {
    const c: ColorFn = (key) => theme[key];
    return `
${buildNodeBaseRules(prefix, c)}
${buildEdgeRules(prefix, c)}
${buildDragRules(prefix)}
${buildTooltipRules(prefix, c)}
${extraDiagram ? extraDiagram(c) : ''}
`;
}
