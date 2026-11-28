import { buildCanvasRules } from '@kiao-dashboard-kit/diagram-shared';
import { ArchDiaTheme, ARCHDIA_DARK, ARCHDIA_LIGHT, ARCHDIA_CSS_VARS, archDiaThemeToCssVars } from './archdia-theme';

// ── Shared CSS rule builder ──────────────────────────────────────

type ColorFn = (key: keyof ArchDiaTheme) => string;

/**
 * Build the shared diagram CSS rules.
 * `c` maps a theme key to its CSS value — either a `var()` expression
 * (browser) or a literal colour (standalone SVG export).
 */
function buildDiagramRules(c: ColorFn): string {
    return `
.archdia-svg {
    background-color: ${c('bg')};
}

/* --- Components --- */

.archdia-component-box {
    fill: ${c('accentBg')};
    stroke: ${c('boxBorder')};
    stroke-width: 1.5;
}

.archdia-component-shape {
    fill: ${c('accentBg')};
    stroke: ${c('text')};
    stroke-width: 1.5;
}

.archdia-component-label {
    fill: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    pointer-events: none;
}

.archdia-component-stereotype {
    fill: ${c('text')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
}

/* C4 _Ext elements — outside the system under design, so they recede */

.archdia-component-external .archdia-component-box,
.archdia-component-external .archdia-component-shape {
    fill: ${c('bg')};
    stroke: ${c('muted')};
    stroke-opacity: 0.5;
}

.archdia-component-external .archdia-component-label,
.archdia-component-external .archdia-component-stereotype {
    fill: ${c('muted')};
}

/* --- Containers --- */

.archdia-container-box {
    fill: ${c('accentBg')};
    fill-opacity: 0.32;
    stroke: ${c('border')};
    stroke-width: 1.5;
    stroke-dasharray: 6 3;
}

.archdia-container-label {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-weight: 600;
    pointer-events: none;
}

.archdia-container-stereotype {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    font-weight: 600;
}

.archdia-container-zone .archdia-container-box {
    fill-opacity: 0.15;
    stroke: ${c('border')};
    stroke-dasharray: none;
}

.archdia-container-district .archdia-container-box {
    fill-opacity: 0.4;
    stroke: ${c('border')};
    stroke-dasharray: none;
}

.archdia-container-trust .archdia-container-box {
    fill: transparent;
    fill-opacity: 0;
    stroke: #ef4444;
    stroke-width: 3;
    stroke-dasharray: 10 5;
}

.archdia-container-trust .archdia-container-label {
    fill: #ef4444;
}

.archdia-container-trust .archdia-container-stereotype {
    fill: #ef4444;
}

/* A deployable perimeter cuts across the functional grouping instead of nesting inside it:
   no fill, so what it covers stays readable, and the accent colour rather than the trust
   boundary's red, which means danger. */
.archdia-container-deployable .archdia-container-box {
    fill: transparent;
    fill-opacity: 0;
    stroke: ${c('link')};
    stroke-width: 2.5;
    stroke-dasharray: none;
}

.archdia-container-deployable .archdia-container-label {
    fill: ${c('link')};
}

/* The leaves of a decomposition — an urbanisation block, an ArchiMate application service or
   function — are all drawn the same: what tells them apart is the diagram they are in. */
.archdia-component-block .archdia-component-box,
.archdia-component-app-service .archdia-component-box,
.archdia-component-app-function .archdia-component-box {
    fill-opacity: 1;
    stroke: ${c('boxBorder')};
}

/* --- Relations --- */

.archdia-relation-line {
    stroke: ${c('muted')};
    stroke-width: 1.2;
}

.archdia-relation-label {
    fill: ${c('muted')};
    font-family: 'Inter', 'Segoe UI', sans-serif;
    pointer-events: none;
}

/* The band a relation is caught by: as wide as a fingertip and painted with nothing, so it
   shows nowhere and answers everywhere along the curve. */
.archdia-relation-hit {
    stroke: transparent;
    stroke-width: 14;
}

/* The handle a relation's centre is moved by. It is there to be grabbed at all times — the
   middle of a relation is where one reaches for to bend it — but it only shows itself under the
   pointer, so a diagram at rest is the diagram and not its controls. The transparent stroke is
   what makes it catchable from a few pixels out: a disc of six is a small thing to ask a hand
   to land on, and a stroke widens what answers without widening what is drawn. */
.archdia-relation-handle {
    fill: ${c('link')};
    stroke: transparent;
    stroke-width: 8;
    opacity: 0;
    cursor: grab;
}

.archdia-relation-bendable:hover .archdia-relation-handle,
.archdia-relation-handle-held {
    opacity: 0.9;
}

.archdia-relation-handle-held {
    cursor: grabbing;
}

.archdia-arrowhead {
    fill: ${c('muted')};
    color: ${c('muted')};
}

/* --- Class Members --- */

.archdia-class-separator {
    stroke: ${c('border')};
    stroke-width: 1;
}

.archdia-class-member {
    fill: ${c('text')};
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    pointer-events: none;
}

.archdia-class-member-static {
    text-decoration: underline;
}

.archdia-class-member-abstract {
    font-style: italic;
}

.archdia-class-visibility {
    fill: ${c('muted')};
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

/* ─── What the pointer can take hold of ──────────────────────────────
 *
 * A diagram gives no sign of which of the things drawn on it answer to a hand: a component that
 * can be dragged and one that is only a picture of a component are the same rectangle. So each
 * lights up as the pointer reaches it, and that is the whole of the message — *this* moves.
 *
 * Every selector below hangs off a class the renderer only puts on when it was given something
 * to call: archdia-draggable and archdia-editable on an element, archdia-relation-bendable on a
 * relation. A diagram being read — the same component, drawn by the same code, with no
 * callbacks behind it — carries none of them, so nothing lights up under a pointer that could
 * not have moved it anyway, and an export carries these rules as dead letters.
 *
 * Elements are ringed rather than tinted, as a selected note is in the mindmap: the fill of a
 * component is its own, said by its stereotype, and a wash over it would overrule the very thing
 * the drawing is saying. A relation has no fill to keep, so it is its band that lights up —
 * which also says how far out from the curve the pointer is still on it.
 */

.archdia-draggable:hover .archdia-component-box,
.archdia-editable:hover .archdia-component-box,
.archdia-draggable:hover .archdia-component-shape,
.archdia-editable:hover .archdia-component-shape,
.archdia-draggable:hover .archdia-container-box,
.archdia-editable:hover .archdia-container-box {
    stroke: ${c('link')};
    stroke-width: 2.5;
}

/* A trust boundary is red because that is what it means, and a hover is not news worth
   overwriting it with. It thickens instead, which says the same thing in the colour it owns. */
.archdia-container-trust.archdia-draggable:hover .archdia-container-box,
.archdia-container-trust.archdia-editable:hover .archdia-container-box {
    stroke: #ef4444;
    stroke-width: 4.5;
}

.archdia-relation-bendable:hover .archdia-relation-hit {
    stroke: ${c('link')};
    opacity: 0.22;
}

/* --- Drag-and-drop --- */

.archdia-draggable {
    cursor: grab;
}

.archdia-dragging .archdia-draggable {
    cursor: grabbing;
}

.archdia-dragging {
    user-select: none;
}

/* --- Floating Editor --- */

.archdia-editable {
    cursor: text;
}

.archdia-description-editor-container {
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

.archdia-description-editor-textarea {
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

.archdia-description-editor-textarea::placeholder {
    color: ${c('muted')};
    opacity: 0.7;
}

/* --- Markdown Tooltips --- */

.archdia-tooltip {
    pointer-events: none;
}

.archdia-tooltip-body {
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

.archdia-tooltip-body p {
    margin: 0 0 8px 0;
}
.archdia-tooltip-body p:last-child {
    margin-bottom: 0;
}
.archdia-tooltip-body h1, .archdia-tooltip-body h2,
.archdia-tooltip-body h3, .archdia-tooltip-body h4,
.archdia-tooltip-body h5, .archdia-tooltip-body h6 {
    margin: 0 0 6px 0;
    font-size: 14px;
    font-weight: 600;
    color: ${c('text')};
}
.archdia-tooltip-body ul, .archdia-tooltip-body ol {
    margin: 0 0 8px 0;
    padding-left: 20px;
}
.archdia-tooltip-body li {
    margin-bottom: 2px;
}
.archdia-tooltip-body code {
    background: ${c('accentBg')};
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
}
.archdia-tooltip-body strong {
    font-weight: 600;
}
.archdia-tooltip-body a {
    color: ${c('link')};
    text-decoration: none;
}

/* --- Inline CSS-only Tooltips (for static SVG export) ---
   Base rule hides them. Export CSS enables via :has() hover rules embedded in the SVG.
   Browser CSS overrides with !important so the React overlay handles tooltips instead. */

.archdia-inline-tooltip {
    display: none;
    pointer-events: none;
}`;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Returns the centralized ArchDia CSS string for browser use.
 * Uses CSS custom properties with fallbacks.
 * Includes light-theme overrides and canvas styles.
 */
export function getArchDiaStyleString(themeVars?: Partial<ArchDiaTheme>): string {
    const theme = { ...ARCHDIA_DARK, ...themeVars };

    const rootVarsStr = Object.entries(archDiaThemeToCssVars(theme))
        .map(([k, v]) => `    ${k}: ${v};`)
        .join('\n');

    const lightVarsStr = Object.entries(archDiaThemeToCssVars(ARCHDIA_LIGHT))
        .map(([k, v]) => `    ${k}: ${v};`)
        .join('\n');

    // Color function: produce `var(--archdia-<key>, <fallback>)` expressions
    const c: ColorFn = (key) =>
        `var(${ARCHDIA_CSS_VARS[key]}, ${theme[key]})`;

    return `
/* ─── ArchDia Default Theme (Dark) ─────────────────────────────────── */
.archdia-canvas, .archdia-svg {
${rootVarsStr}
}

.archdia-theme-light,
.archdia-theme-light .archdia-canvas,
.archdia-theme-light .archdia-svg,
.archdia-canvas.archdia-theme-light,
.archdia-svg.archdia-theme-light {
${lightVarsStr}
}
${buildDiagramRules(c)}


/* Prevent inline export tooltips from showing in browser when hovering other elements */
.archdia-inline-tooltip {
    /* No longer !important so our :has(:hover) overrides it */
    display: none;
}
${buildCanvasRules('archdia')}
`;
}

/**
 * Returns a flat CSS string for SVG export.
 * Colors are baked in as literal values (no CSS variables).
 * Does not include toolbar styles.
 */
export function getArchDiaExportStyleString(theme: ArchDiaTheme): string {
    const c: ColorFn = (key) => theme[key];

    return `
/* ─── ArchDia Export Styles ────────────────────────────────────────── */
${buildDiagramRules(c)}

/* An exported diagram is read, never edited: the handles its relations are bent by
   have nothing to offer it. */
.archdia-relation-handle {
    display: none;
}

`;
}
