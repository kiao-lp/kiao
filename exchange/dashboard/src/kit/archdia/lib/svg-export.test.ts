/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { serializeSvgForExport } from './svg-export';
import { ARCHDIA_DARK, ARCHDIA_LIGHT } from './archdia-theme';

// Mock getComputedStyle since we're not running a full browser environment
const originalGetComputedStyle = window.getComputedStyle;

describe('SVG Export E2E Tests', () => {

    it('exports SVG correctly matching LIGHT theme properties', () => {
        // Mock document.documentElement styles (simulating light theme CSS variables)
        window.getComputedStyle = vi.fn().mockReturnValue({
            getPropertyValue: (prop: string) => {
                const map: Record<string, string> = {
                    '--archdia-bg': ARCHDIA_LIGHT.bg,
                    '--archdia-text': ARCHDIA_LIGHT.text,
                    '--archdia-border': ARCHDIA_LIGHT.border,
                    '--archdia-accent-bg': ARCHDIA_LIGHT.accentBg,
                };
                return map[prop] || '';
            }
        });

        // Construct a mock SVGElement tree
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 1000 500');

        // Add an end component
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'archdia-component');
        svg.appendChild(rect);

        const exportedString = serializeSvgForExport(svg, ARCHDIA_LIGHT);

        // Expect the background rect to be injected with the light theme background color
        expect(exportedString).toContain(`<rect x="0" y="0" width="1000" height="500" fill="${ARCHDIA_LIGHT.bg}" />`);

        // Expect light styling inside style tag
        expect(exportedString).toContain(ARCHDIA_LIGHT.accentBg);

        window.getComputedStyle = originalGetComputedStyle;
    });

    it('exports SVG correctly matching DARK theme properties', () => {
        // Mock document.documentElement styles (simulating dark theme CSS variables)
        window.getComputedStyle = vi.fn().mockReturnValue({
            getPropertyValue: (prop: string) => {
                const map: Record<string, string> = {
                    '--archdia-bg': ARCHDIA_DARK.bg,
                    '--archdia-text': ARCHDIA_DARK.text,
                    '--archdia-border': ARCHDIA_DARK.border,
                    '--archdia-accent-bg': ARCHDIA_DARK.accentBg,
                };
                return map[prop] || '';
            }
        });

        // Construct a mock SVGElement tree
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 1000 500');

        const exportedString = serializeSvgForExport(svg, ARCHDIA_DARK);

        // Expect the background rect to be injected with the dark theme background color
        expect(exportedString).toContain(`<rect x="0" y="0" width="1000" height="500" fill="${ARCHDIA_DARK.bg}" />`);

        // Expect dark styling inside style tag
        expect(exportedString).toContain(ARCHDIA_DARK.accentBg);

        window.getComputedStyle = originalGetComputedStyle;
    });
});
