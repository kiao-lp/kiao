/**
 * The unified diagram look — the one place that knows what a box is.
 *
 * Every diagram rendered from markdown (mermaid, PlantUML, archdia, graph) and
 * the PDF export draw from these values: one palette per theme for the colours,
 * one geometry for the shapes. A change here moves every renderer at once.
 *
 * Where each value comes from:
 * - box fill: archdia's component fill, a light grey over the page;
 * - box border colour: the PlantUML activity boxes' (`muted`), clearly
 *   contrasted with the page yet below the text inside;
 * - box radius: archdia's 8px;
 * - box padding: the PlantUML activity boxes' 10px a side;
 * - box text: archdia's 16px Inter in the theme's text colour;
 * - edge labels: 14px, halfway between archdia's 12 and mermaid's 16.
 *
 * The archdia/graph kits do not depend on the design system, so they mirror
 * the geometry in `@cms-kit/diagram-shared` and read the colours from the
 * application's CSS variables wherever markdown is rendered.
 *
 * Two palette entries are exposed as application CSS variables, so non-diagram
 * UI (such as the hybridflow board) can wear the same look without depending
 * on this module: `boxFill` as `--diagram-box-fill` and `groupBg` as
 * `--diagram-group-bg`, both carried by every theme CSS file.
 */

import type { KiaoTheme } from './kiao-themes.js';
import { kiaoDarkTokens } from './kiao-ant-theme-dark.js';
import { kiaoLightTokens } from './kiao-ant-theme-light.js';
import { kiaoSoberDarkTokens } from './kiao-ant-theme-sober-dark.js';
import { kiaoSoberLightTokens } from './kiao-ant-theme-sober-light.js';

/** Colours shared by every diagram renderer, for one theme. */
export interface KiaoDiagramPalette {
    /** Diagram background — always the page's own. */
    pageBg: string;
    /** Box fill — a light grey over the page. */
    boxFill: string;
    /** Box outline — contrasted with the page, below the text inside. */
    boxBorder: string;
    /** Text inside a box. */
    boxText: string;
    /** Lines and arrows between boxes, and their labels. */
    edge: string;
    /** Fill of what holds other shapes (packages, clusters, groups). */
    groupBg: string;
    /** Fill of notes and callouts. */
    noteBg: string;
    /** Header band of class boxes. */
    headerBg: string;
    /** Start/end dots and other small accents. */
    accent: string;
}

/** Shapes shared by every diagram renderer, in every theme. */
export const KIAO_DIAGRAM_GEOMETRY = {
    /** Corner radius of a box, in px. */
    boxRadius: 8,
    /**
     * The `RoundCorner` skinparam that draws an 8px radius: PlantUML renders
     * half the value it is given, so this is twice `boxRadius`.
     */
    plantUmlRoundCorner: 16,
    /** Text size inside a box, in px. */
    boxFontSize: 16,
    /** Text size on a line or arrow, in px. */
    edgeLabelFontSize: 14,
    /** Typeface of every diagram text. */
    boxFontFamily: "'Inter', 'Segoe UI', sans-serif",
    /** Horizontal padding inside a box, in px a side. */
    boxPadX: 10,
} as const;

const dark = kiaoDarkTokens.colors;
const light = kiaoLightTokens.colors;
const soberDark = kiaoSoberDarkTokens.colors;
const soberLight = kiaoSoberLightTokens.colors;

const PALETTES: Record<KiaoTheme, KiaoDiagramPalette> = {
    dark: {
        pageBg: dark.bg,
        boxFill: dark.accentBg,
        boxBorder: dark.muted,
        boxText: dark.text,
        edge: dark.muted,
        groupBg: '#070b18',
        noteBg: '#1a2236',
        headerBg: '#1a2236',
        accent: dark.link,
    },
    light: {
        pageBg: light.bg,
        boxFill: '#e8eaf0',
        boxBorder: light.muted,
        boxText: light.text,
        edge: light.muted,
        groupBg: '#f0f1f5',
        noteBg: '#dfe1e8',
        headerBg: '#dfe1e8',
        accent: light.link,
    },
    'sober-dark': {
        pageBg: soberDark.bg,
        boxFill: soberDark.accentBg,
        boxBorder: soberDark.muted,
        boxText: soberDark.text,
        edge: soberDark.muted,
        groupBg: '#12171F',
        noteBg: '#1C2128',
        headerBg: '#21262D',
        accent: soberDark.accent,
    },
    'sober-light': {
        pageBg: soberLight.bg,
        boxFill: soberLight.accentBg,
        boxBorder: soberLight.muted,
        boxText: soberLight.text,
        edge: soberLight.muted,
        groupBg: '#F1F5F9',
        noteBg: '#F1F5F9',
        headerBg: '#E2E8F0',
        accent: soberLight.accent,
    },
};

export function kiaoDiagramPalette(theme: KiaoTheme): KiaoDiagramPalette {
    return PALETTES[theme] ?? PALETTES.dark;
}

/**
 * The palette diagrams are drawn with on paper: the light palette on a white
 * page, independently of the configured PDF theme.
 */
export function kiaoDiagramPdfPalette(): KiaoDiagramPalette {
    return { ...PALETTES.light, pageBg: '#ffffff' };
}
