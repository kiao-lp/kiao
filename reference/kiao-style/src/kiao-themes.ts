/**
 * The themes the charter ships, and the one place that knows what each one is made of.
 *
 * A theme is a name — what goes in `<html data-theme>` — and four things that name picks:
 * a CSS token block, an antd ThemeConfig, a set of mermaid variables, a PlantUML skinparam
 * block. Everything downstream asks here rather than writing `theme === 'dark' ? … : …`,
 * which is the shape that made adding a third theme a change in a dozen files.
 *
 * `themeMode` is the other half. Plenty of renderers own exactly two palettes — CodeMirror,
 * archdia, the mermaid built-ins — and cannot be given a third. They do not need the theme,
 * they need its brightness, and that is what a mode is.
 */

import type { ThemeConfig } from 'antd';
import { kiaoDarkTheme } from './kiao-ant-theme-dark.js';
import { kiaoLightTheme } from './kiao-ant-theme-light.js';
import { kiaoSoberDarkTheme } from './kiao-ant-theme-sober-dark.js';
import { kiaoSoberLightTheme } from './kiao-ant-theme-sober-light.js';
import { kiaoMermaidDark } from './kiao-mermaid-theme-dark.js';
import { kiaoMermaidLight } from './kiao-mermaid-theme-light.js';
import { kiaoMermaidSoberDark } from './kiao-mermaid-theme-sober-dark.js';
import { kiaoMermaidSoberLight } from './kiao-mermaid-theme-sober-light.js';
import {
    kiaoPlantUMLDark,
    kiaoPlantUMLLight,
    kiaoPlantUMLSoberDark,
    kiaoPlantUMLSoberLight,
} from './kiao-plantuml-theme.js';

/** A theme's name, as written in `<html data-theme>`. */
export type KiaoTheme = 'dark' | 'light' | 'sober-dark' | 'sober-light';

/** A theme's brightness — what a renderer that owns only two palettes needs. */
export type ThemeMode = 'dark' | 'light';

export interface KiaoThemeDescriptor {
    id: KiaoTheme;
    /** What to call it in a menu. */
    label: string;
    mode: ThemeMode;
}

/** Every theme, in the order a menu should offer them: the charter's, then the sober ones. */
export const KIAO_THEMES: readonly KiaoThemeDescriptor[] = [
    { id: 'dark', label: 'Dark', mode: 'dark' },
    { id: 'light', label: 'Light', mode: 'light' },
    { id: 'sober-dark', label: 'Sober dark', mode: 'dark' },
    { id: 'sober-light', label: 'Sober light', mode: 'light' },
];

/** What `index.html` carries and what an unreadable stored choice falls back to. */
export const DEFAULT_KIAO_THEME: KiaoTheme = 'dark';

export function isKiaoTheme(value: unknown): value is KiaoTheme {
    return typeof value === 'string' && KIAO_THEMES.some(t => t.id === value);
}

/**
 * Reads anything as a theme, falling back to the default.
 *
 * The name comes from places that cannot be trusted to hold one: a stored preference written
 * by an older version, a `data-theme` set by hand. A name that is not a theme has no styling
 * behind it, so treating it as the default is the only reading that leaves a legible screen.
 */
export function asKiaoTheme(value: unknown): KiaoTheme {
    return isKiaoTheme(value) ? value : DEFAULT_KIAO_THEME;
}

export function themeMode(theme: KiaoTheme): ThemeMode {
    return KIAO_THEMES.find(t => t.id === theme)?.mode ?? 'dark';
}

export function kiaoAntTheme(theme: KiaoTheme): ThemeConfig {
    switch (theme) {
        case 'light': return kiaoLightTheme;
        case 'sober-dark': return kiaoSoberDarkTheme;
        case 'sober-light': return kiaoSoberLightTheme;
        default: return kiaoDarkTheme;
    }
}

export function kiaoMermaidTheme(theme: KiaoTheme): Record<string, unknown> {
    switch (theme) {
        case 'light': return kiaoMermaidLight;
        case 'sober-dark': return kiaoMermaidSoberDark;
        case 'sober-light': return kiaoMermaidSoberLight;
        default: return kiaoMermaidDark;
    }
}

export function kiaoPlantUMLTheme(theme: KiaoTheme): string {
    switch (theme) {
        case 'light': return kiaoPlantUMLLight;
        case 'sober-dark': return kiaoPlantUMLSoberDark;
        case 'sober-light': return kiaoPlantUMLSoberLight;
        default: return kiaoPlantUMLDark;
    }
}
