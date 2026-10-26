import { describe, it, expect } from 'vitest';
import {
    KIAO_THEMES,
    KIAO_DIAGRAM_GEOMETRY,
    kiaoDiagramPalette,
    kiaoDiagramPdfPalette,
    kiaoMermaidTheme,
    kiaoPlantUMLTheme,
    kiaoPlantUMLPdf,
    type KiaoTheme,
    type KiaoDiagramPalette,
} from 'kiao-style';
import {
    BOX_RADIUS,
    BOX_FONT_SIZE,
    EDGE_LABEL_FONT_SIZE,
    BOX_PAD_X,
    BOX_MIN_WIDTH,
    BOX_HEIGHT,
    BOX_LINE_STEP,
    THEME_DARK,
    THEME_LIGHT,
} from '@cms-kit/diagram-shared';
import {
    ARCHDIA_DARK,
    estimateNodeWidth,
    getArchDiaExportStyleString,
    getArchDiaStyleString,
    getNodeHeight,
} from '@cms-kit/archdia';
import {
    estimateNodeWidth as estimateGraphNodeWidth,
    getNodeHeight as getGraphNodeHeight,
} from '@cms-kit/graph';

/**
 * The unified diagram look: one palette per theme, one geometry for every
 * renderer. These tests pin the derivation — palette → mermaid variables,
 * PlantUML skinparams, archdia/graph boxes — so a change in one place cannot
 * silently stop reaching the others.
 */

const EXPECTED_PALETTES: Record<KiaoTheme, Pick<KiaoDiagramPalette, 'pageBg' | 'boxFill' | 'boxBorder' | 'boxText' | 'edge'>> = {
    dark: {
        pageBg: '#020511',
        boxFill: '#121826',
        boxBorder: '#D5DEEF',
        boxText: '#FFFFFF',
        edge: '#D5DEEF',
    },
    light: {
        pageBg: '#F9FAFB',
        boxFill: '#e8eaf0',
        boxBorder: '#6B7280',
        boxText: '#111827',
        edge: '#6B7280',
    },
    'sober-dark': {
        pageBg: '#0D1117',
        boxFill: '#161B22',
        boxBorder: '#8B949E',
        boxText: '#E6EDF3',
        edge: '#8B949E',
    },
    'sober-light': {
        pageBg: '#F8FAFC',
        boxFill: '#FFFFFF',
        boxBorder: '#64748B',
        boxText: '#0F172A',
        edge: '#64748B',
    },
};

describe('unified diagrams — the shared palette', () => {
    it.each(KIAO_THEMES.map(t => t.id))('exposes the %s box colours', (theme) => {
        expect(kiaoDiagramPalette(theme)).toMatchObject(EXPECTED_PALETTES[theme]);
    });

    it('draws paper diagrams light on white', () => {
        expect(kiaoDiagramPdfPalette()).toMatchObject({ ...EXPECTED_PALETTES.light, pageBg: '#ffffff' });
    });

    it('keeps the kits mirrored on the shared geometry', () => {
        // The kits do not depend on the design system, so they carry their own
        // copy of these numbers — pinned equal here instead of imported.
        expect(BOX_RADIUS).toBe(KIAO_DIAGRAM_GEOMETRY.boxRadius);
        expect(BOX_FONT_SIZE).toBe(KIAO_DIAGRAM_GEOMETRY.boxFontSize);
        expect(EDGE_LABEL_FONT_SIZE).toBe(KIAO_DIAGRAM_GEOMETRY.edgeLabelFontSize);
        expect(BOX_PAD_X).toBe(KIAO_DIAGRAM_GEOMETRY.boxPadX);
    });
});

describe('unified diagrams — mermaid derives from the palette', () => {
    it.each(KIAO_THEMES.map(t => t.id))('draws %s boxes from the palette', (theme) => {
        const p = EXPECTED_PALETTES[theme];
        const vars = kiaoMermaidTheme(theme) as Record<string, string>;
        expect(vars.background).toBe(p.pageBg);
        expect(vars.primaryColor).toBe(p.boxFill);
        expect(vars.primaryBorderColor).toBe(p.boxBorder);
        expect(vars.primaryTextColor).toBe(p.boxText);
        expect(vars.mainBkg).toBe(p.boxFill);
        expect(vars.nodeBorder).toBe(p.boxBorder);
        expect(vars.actorBkg).toBe(p.boxFill);
        expect(vars.actorBorder).toBe(p.boxBorder);
        expect(vars.lineColor).toBe(p.edge);
        expect(vars.edgeLabelBackground).toBe(p.pageBg);
        expect(vars.fontSize).toBe(`${KIAO_DIAGRAM_GEOMETRY.boxFontSize}px`);
    });
});

describe('unified diagrams — PlantUML derives from the palette', () => {
    it.each(KIAO_THEMES.map(t => t.id))('draws %s boxes from the palette', (theme) => {
        const p = EXPECTED_PALETTES[theme];
        const skin = kiaoPlantUMLTheme(theme);
        expect(skin).toContain(`skinparam backgroundColor ${p.pageBg}`);
        expect(skin).toContain(`skinparam defaultFontSize ${KIAO_DIAGRAM_GEOMETRY.boxFontSize}`);
        expect(skin).toContain(`skinparam ArrowFontSize ${KIAO_DIAGRAM_GEOMETRY.edgeLabelFontSize}`);
        expect(skin).toContain(`skinparam RoundCorner ${KIAO_DIAGRAM_GEOMETRY.plantUmlRoundCorner}`);
        expect(skin).toContain(`BackgroundColor ${p.boxFill}`);
        expect(skin).toContain(`BorderColor ${p.boxBorder}`);
        expect(skin).toContain(`FontColor ${p.boxText}`);
    });

    it('draws the PDF skinparams light on white', () => {
        expect(kiaoPlantUMLPdf).toContain('skinparam backgroundColor #ffffff');
        expect(kiaoPlantUMLPdf).toContain(`BackgroundColor ${EXPECTED_PALETTES.light.boxFill}`);
    });
});

describe('unified diagrams — archdia boxes', () => {
    it('outlines boxes with the overridable box border', () => {
        const rule = getArchDiaStyleString().match(/\.archdia-component-box \{([^}]*)\}/)![1];
        expect(rule).toContain('var(--archdia-box-border');
    });

    it('bakes a box-border override into exports', () => {
        const css = getArchDiaExportStyleString({ ...ARCHDIA_DARK, boxBorder: '#abcdef' });
        const rule = css.match(/\.archdia-component-box \{([^}]*)\}/)![1];
        expect(rule).toContain('#abcdef');
    });

    it('keeps the editor default on the old border', () => {
        expect(THEME_DARK.boxBorder).toBe(THEME_DARK.border);
        expect(THEME_LIGHT.boxBorder).toBe(THEME_LIGHT.border);
    });

    it('pads a label with the shared metrics', () => {
        // 'A' at 16px spans ~11px, so the 60px minimum binds.
        expect(estimateNodeWidth('A')).toBe(BOX_MIN_WIDTH);
        // 'Se lever' spans ~59px at 16px: text plus 10px a side.
        expect(estimateNodeWidth('Se lever')).toBeCloseTo(58.7 + BOX_PAD_X * 2, 0);
        expect(getNodeHeight('component')).toBe(BOX_HEIGHT);
        expect(getNodeHeight('component', undefined, 'one\\ntwo')).toBe(BOX_HEIGHT + BOX_LINE_STEP);
    });

    it('widens a short label for its drawn stereotype', () => {
        const bare = estimateNodeWidth('API');
        expect(estimateNodeWidth('API', undefined, 'service')).toBeGreaterThan(bare);
    });
});

describe('unified diagrams — graph boxes', () => {
    it('pads a title with the shared metrics', () => {
        expect(estimateGraphNodeWidth('A')).toBe(BOX_MIN_WIDTH);
        expect(estimateGraphNodeWidth('Se lever')).toBeGreaterThan(BOX_MIN_WIDTH);
        expect(getGraphNodeHeight()).toBe(BOX_HEIGHT);
    });
});
