/**
 * ArchDia theme — delegates to the shared theme system with
 * backward-compatible aliases for existing consumers.
 */

import {
    DiagramTheme,
    THEME_DARK,
    THEME_LIGHT,
    getCssVarNames,
    resolveTheme,
    themeToCssVars,
} from '@cms-kit/diagram-shared';

// ── Backward-compatible type alias ───────────────────────────────

export type ArchDiaTheme = DiagramTheme;

// ── Palette constants ────────────────────────────────────────────

export const ARCHDIA_DARK: ArchDiaTheme = THEME_DARK;
export const ARCHDIA_LIGHT: ArchDiaTheme = THEME_LIGHT;

// ── CSS custom-property names ────────────────────────────────────

export const ARCHDIA_CSS_VARS = getCssVarNames('archdia');

// ── Helpers ──────────────────────────────────────────────────────

export function resolveArchDiaTheme(
    overrides?: Partial<ArchDiaTheme>,
    element?: Element | null,
): ArchDiaTheme {
    return resolveTheme(ARCHDIA_CSS_VARS, overrides, element);
}

export function archDiaThemeToCssVars(theme: ArchDiaTheme): Record<string, string> {
    return themeToCssVars(ARCHDIA_CSS_VARS, theme);
}
