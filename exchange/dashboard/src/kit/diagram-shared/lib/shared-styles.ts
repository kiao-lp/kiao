/**
 * Shared CSS rule builders parameterized by class-name prefix.
 *
 * Each diagram package (archdia, graph, …) calls these with its own
 * prefix to produce package-specific CSS class names while reusing
 * the same visual rules.
 */

import { DiagramTheme, CssVarNames, THEME_DARK, THEME_LIGHT, themeToCssVars } from './theme';

export type ColorFn = (key: keyof DiagramTheme) => string;

// ── Node / Component base rules ──────────────────────────────────

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

// ── Edge / Relation rules ────────────────────────────────────────

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

// ── Drag rules ───────────────────────────────────────────────────

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

// ── Tooltip rules ────────────────────────────────────────────────

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

// ── Description editor rules ─────────────────────────────────────

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

// ── Toolbar rules ────────────────────────────────────────────────

export function buildToolbarRules(p: string, c: ColorFn): string {
    return `
.${p}-toolbar {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 12px;
    background: rgba(20, 24, 36, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    box-sizing: border-box;
    user-select: none;
}

.${p}-toolbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}

.${p}-toolbar-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.${p}-toolbar-btn--active {
    color: ${c('link')};
}

.${p}-toolbar-btn--active:hover {
    color: ${c('link')};
    background: rgba(96, 165, 250, 0.12);
}

.${p}-toolbar-zoom-label {
    font-size: 11px;
    font-weight: 600;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    padding: 0 4px;
    min-width: 38px;
    letter-spacing: -0.02em;
    color: rgba(255, 255, 255, 0.55);
}

.${p}-toolbar-separator {
    width: 1px;
    height: 16px;
    margin: 0 8px;
    background: rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
}

/* Size Dropdown */

.${p}-toolbar-size-dropdown {
    position: relative;
    display: inline-flex;
}

.${p}-toolbar-btn.${p}-toolbar-size-label {
    font-size: 11px;
    font-weight: 600;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    min-width: 80px;
    width: auto;
    height: 28px;
    padding: 0 8px;
    letter-spacing: -0.02em;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    overflow: visible;
}

.${p}-toolbar-size-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    background: rgba(20, 24, 36, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
    z-index: 120;
}

.${p}-toolbar-size-option {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}

.${p}-toolbar-size-option:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.${p}-toolbar-size-option--active {
    color: ${c('link')};
}

.${p}-toolbar-size-option--active:hover {
    color: ${c('link')};
    background: rgba(96, 165, 250, 0.12);
}

.${p}-toolbar-size-separator {
    height: 1px;
    margin: 4px 6px;
    background: rgba(255, 255, 255, 0.08);
}

.${p}-toolbar-size-custom {
    padding: 6px 8px 4px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.${p}-toolbar-size-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
}

.${p}-toolbar-size-field {
    display: flex;
    align-items: center;
    flex: 1;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 0 6px;
    transition: border-color 0.15s;
}

.${p}-toolbar-size-field:focus-within {
    border-color: ${c('link')};
}

.${p}-toolbar-size-field label {
    font-size: 9px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.3);
    margin-right: 4px;
    text-transform: uppercase;
}

.${p}-toolbar-size-field input {
    width: 100%;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    padding: 4px 0;
    outline: none;
    -moz-appearance: textfield;
}

.${p}-toolbar-size-field input::-webkit-outer-spin-button,
.${p}-toolbar-size-field input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.${p}-toolbar-size-apply {
    width: 100%;
    padding: 6px;
    border: none;
    border-radius: 4px;
    background: ${c('link')};
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
}

.${p}-toolbar-size-apply:hover:not(:disabled) { opacity: 0.9; }
.${p}-toolbar-size-apply:active:not(:disabled) { transform: scale(0.98); }
.${p}-toolbar-size-apply:disabled { opacity: 0.4; cursor: not-allowed; }`;
}

// ── Canvas rules ─────────────────────────────────────────────────

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

// ── Full style string assembly ───────────────────────────────────

/**
 * Build the complete browser CSS for a diagram package.
 *
 * @param prefix         CSS class prefix (e.g. 'archdia', 'graph').
 * @param cssVars        CSS variable names for this package.
 * @param extraDiagram   Additional diagram-specific CSS rules.
 * @param themeOverrides Optional dark-theme overrides.
 */
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
${buildToolbarRules(prefix, c)}
${buildCanvasRules(prefix)}
`;
}

/**
 * Build export CSS (baked-in colours, no toolbar/canvas rules).
 */
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
