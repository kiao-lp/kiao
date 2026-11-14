/** Each diagram package uses its own CSS-variable prefix and shares this palette and resolution. */

// Palettes.

export interface DiagramTheme {
    bg: string;
    /** Element fill. */
    accentBg: string;
    text: string;
    border: string;
    /** Box outline, distinct from `border`. Markdown and PDF export override it. */
    boxBorder: string;
    muted: string;
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

// CSS custom-property names.

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

// Helpers.

/** Priority: `overrides`, then CSS variables on `element` or the document root, then dark defaults. */
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
