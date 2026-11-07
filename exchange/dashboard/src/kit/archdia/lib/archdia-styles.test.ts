import { describe, it, expect } from 'vitest';
import { getArchDiaStyleString, getArchDiaExportStyleString } from './archdia-styles';
import { ARCHDIA_DARK, ARCHDIA_LIGHT } from './archdia-theme';

describe('getArchDiaStyleString (browser styles)', () => {
    it('contains CSS variable definitions on .archdia-canvas, .archdia-svg', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('.archdia-canvas');
        expect(css).toContain('.archdia-svg');
        expect(css).toContain('--archdia-bg');
        expect(css).toContain('--archdia-text');
        expect(css).toContain('--archdia-border');
        expect(css).toContain('--archdia-accent-bg');
        expect(css).toContain('--archdia-muted');
        expect(css).toContain('--archdia-link');
    });

    it('contains light theme override block', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('.archdia-theme-light');
        expect(css).toContain(ARCHDIA_LIGHT.bg);
    });

    it('uses var() references in component classes', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('var(--archdia-text');
        expect(css).toContain('var(--archdia-border');
        expect(css).toContain('var(--archdia-accent-bg');
        expect(css).toContain('var(--archdia-muted');
    });

    it('contains all diagram element classes', () => {
        const css = getArchDiaStyleString();
        const requiredClasses = [
            '.archdia-component-box',
            '.archdia-component-shape',
            '.archdia-component-label',
            '.archdia-component-stereotype',
            '.archdia-container-box',
            '.archdia-container-label',
            '.archdia-container-deployable',
            '.archdia-relation-line',
            '.archdia-relation-label',
            '.archdia-arrowhead',
            '.archdia-class-separator',
            '.archdia-class-member',
        ];
        for (const cls of requiredClasses) {
            expect(css).toContain(cls);
        }
    });

    it('contains toolbar styles', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('.archdia-toolbar');
        expect(css).toContain('.archdia-toolbar-btn');
    });

    it('repaints the toolbar where the diagram went light', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('.archdia-theme-light .archdia-toolbar');
        expect(css).toContain('.archdia-theme-light .archdia-toolbar-btn');
        expect(css).toContain('.archdia-theme-light .archdia-toolbar-size-menu');
    });

    it('contains drag-and-drop styles', () => {
        const css = getArchDiaStyleString();
        expect(css).toContain('.archdia-draggable');
        expect(css).toContain('.archdia-dragging');
    });

    /**
     * The band is the only thing on a relation a pointer can reasonably be asked to land on, so
     * it has to stay both wide and unpainted: a stroke of a colour would draw a fat line down
     * every relation in the diagram.
     */
    it('gives a relation a band wide enough to point at and painted with nothing', () => {
        const rule = getArchDiaStyleString().match(/\.archdia-relation-hit \{([^}]*)\}/)![1];
        expect(rule).toContain('stroke: transparent');
        expect(Number(rule.match(/stroke-width:\s*(\d+)/)![1])).toBeGreaterThanOrEqual(12);
    });

    /**
     * The highlight says "this moves", so it must not appear over anything that does not. Every
     * hover rule therefore hangs off a class the renderer only writes when it was handed a
     * callback — never off `.archdia-component` or `.archdia-relation` themselves.
     */
    it('lights up only what an editor was given something to do with', () => {
        const interactive = ['archdia-draggable', 'archdia-editable', 'archdia-relation-bendable'];
        const hoverRules = getArchDiaStyleString().match(/[^\n{}]*:hover[^\n{}]*\{/g) ?? [];
        const diagramHovers = hoverRules.filter(r => r.includes('.archdia-') && !r.includes('toolbar'));

        expect(diagramHovers.length).toBeGreaterThan(0);
        for (const rule of diagramHovers) {
            for (const selector of rule.split(',')) {
                if (!selector.includes(':hover')) continue;
                const subject = selector.slice(0, selector.indexOf(':hover'));
                expect(interactive.some(cls => subject.includes(cls)), selector.trim()).toBe(true);
            }
        }
    });

    it('accepts theme overrides', () => {
        const css = getArchDiaStyleString({ bg: '#ff0000' });
        expect(css).toContain('#ff0000');
    });
});

describe('getArchDiaExportStyleString (standalone SVG)', () => {
    it('bakes literal color values (no CSS variables)', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_DARK);
        expect(css).not.toContain('var(--archdia');
        expect(css).toContain(ARCHDIA_DARK.bg);
        expect(css).toContain(ARCHDIA_DARK.accentBg);
        expect(css).toContain(ARCHDIA_DARK.text);
        expect(css).toContain(ARCHDIA_DARK.border);
        expect(css).toContain(ARCHDIA_DARK.muted);
    });

    it('contains all diagram element classes', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_DARK);
        const requiredClasses = [
            '.archdia-component-box',
            '.archdia-component-shape',
            '.archdia-component-label',
            '.archdia-component-stereotype',
            '.archdia-container-box',
            '.archdia-container-label',
            '.archdia-container-deployable',
            '.archdia-relation-line',
            '.archdia-relation-label',
            '.archdia-arrowhead',
            '.archdia-class-separator',
            '.archdia-class-member',
        ];
        for (const cls of requiredClasses) {
            expect(css).toContain(cls);
        }
    });

    it('does NOT contain toolbar styles', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_DARK);
        expect(css).not.toContain('.archdia-toolbar');
    });

    it('does NOT contain light theme block', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_DARK);
        expect(css).not.toContain('.archdia-theme-light');
    });

    it('contains background-color on .archdia-svg', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_DARK);
        expect(css).toContain('.archdia-svg');
        expect(css).toContain('background-color');
    });

    it('uses light theme colors when given light theme', () => {
        const css = getArchDiaExportStyleString(ARCHDIA_LIGHT);
        expect(css).toContain(ARCHDIA_LIGHT.bg);
        expect(css).not.toContain(ARCHDIA_DARK.bg);
    });
});
