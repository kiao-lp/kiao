/**
 * Shared color theme system for the diagram kits.
 *
 * Each package (archdia, graph, …) uses its own CSS custom-property
 * prefix, but shares the same color palette and resolution logic.
 */

// ── Colour palettes ──────────────────────────────────────────────

export interface DiagramTheme {
    /** Diagram background */
    bg: string;
    /** Component / element fill */
    accentBg: string;
    /** Primary text colour */
    text: string;
    /** Stroke / border colour */
    border: string;
    /**
     * Box outline colour.
     *
     * Kept apart from `border` because the two answer different questions: `border`
     * rules panels, containers and separators, while a box outline must hold at a
     * glance against the page. Markdown and the PDF export override it with the
     * theme's muted tone; the editors keep the default below.
     */
    boxBorder: string;
    /** Secondary / muted text colour */
    muted: string;
    /** Link / accent highlight colour */
    link: string;
}

export const THEME_DARK: DiagramTheme = {
    bg: '#020511',
    accentBg: '#121826',
    text: '#ffffff',
    border: '#263040',
    boxBorder: '#263040',
    muted: '#d5deef',
    link: '#60a5fa',
};

export const THEME_LIGHT: DiagramTheme = {
    bg: '#f9fafb',
    accentBg: '#e8eaf0',
    text: '#111827',
    border: '#c8ccd4',
    boxBorder: '#c8ccd4',
    muted: '#6b7280',
    link: '#2563eb',
};

// ── CSS custom-property names (prefix-parametric) ────────────────

export type CssVarNames = Record<keyof DiagramTheme, string>;

export function getCssVarNames(prefix: string): CssVarNames {
    return {
        bg: `--${prefix}-bg`,
        accentBg: `--${prefix}-accent-bg`,
        text: `--${prefix}-text`,
        border: `--${prefix}-border`,
        boxBorder: `--${prefix}-box-border`,
        muted: `--${prefix}-muted`,
        link: `--${prefix}-link`,
    };
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Resolve the effective colour values for the current context.
 *
 * Priority: explicit `overrides` → CSS custom properties on
 * `element` / `document.documentElement` → dark-theme defaults.
 */
export function resolveTheme(
    cssVars: CssVarNames,
    overrides?: Partial<DiagramTheme>,
    element?: Element | null,
): DiagramTheme {
    const computed =
        typeof window !== 'undefined' && element
            ? window.getComputedStyle(element)
            : typeof document !== 'undefined'
                ? getComputedStyle(document.documentElement)
                : undefined;
    const css = (prop: string) => computed?.getPropertyValue(prop)?.trim() || '';

    return {
        bg: overrides?.bg || css(cssVars.bg) || THEME_DARK.bg,
        accentBg: overrides?.accentBg || css(cssVars.accentBg) || THEME_DARK.accentBg,
        text: overrides?.text || css(cssVars.text) || THEME_DARK.text,
        border: overrides?.border || css(cssVars.border) || THEME_DARK.border,
        boxBorder: overrides?.boxBorder || css(cssVars.boxBorder) || THEME_DARK.boxBorder,
        muted: overrides?.muted || css(cssVars.muted) || THEME_DARK.muted,
        link: overrides?.link || css(cssVars.link) || THEME_DARK.link,
    };
}

/**
 * Build a CSSProperties-compatible object that sets all CSS
 * custom properties from a given theme.
 */
export function themeToCssVars(cssVars: CssVarNames, theme: DiagramTheme): Record<string, string> {
    return {
        [cssVars.bg]: theme.bg,
        [cssVars.accentBg]: theme.accentBg,
        [cssVars.text]: theme.text,
        [cssVars.border]: theme.border,
        [cssVars.muted]: theme.muted,
        [cssVars.link]: theme.link,
    };
}
