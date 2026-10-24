import { describe, it, expect, vi, afterEach } from 'vitest';
import { printMarkdownToPdf } from './printMarkdownToPdf';

// ── What the PDF stylesheet does to a diagram ───────────────────────────────
//
// The print window carries its own stylesheet — none of the preview's CSS
// follows the cloned content across — so centering a diagram on paper is a
// rule written here, not one inherited from the preview.

/** Runs the export against a fake print window and returns the document it was handed. */
const exportedHtml = async (content: HTMLElement): Promise<string> => {
    const chunks: string[] = [];
    const fakeWindow = {
        document: {
            write: (html: string) => { chunks.push(html); },
            close: () => {},
            querySelectorAll: () => [],
        },
        print: () => {},
    };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as any);
    try {
        await printMarkdownToPdf(content, { title: 'Test' });
    } finally {
        open.mockRestore();
    }
    return chunks.join('');
};

/** The first `<style>` block — the print stylesheet — of an exported document. */
const printStyles = (html: string): string =>
    html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

/** The standalone `svg { ... }` rule of a stylesheet, if it has one. */
const svgRule = (style: string): string =>
    style.match(/(^|\n)svg \{[^}]*\}/)?.[0] ?? '';

describe('printMarkdownToPdf — a diagram on paper', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('centers a rendered diagram narrower than the page', async () => {
        const content = document.createElement('div');
        content.innerHTML = '<h1>Title</h1><p>An intro.</p>'
            + '<div class="mermaid"><svg width="200" height="100"></svg></div>';

        const rule = svgRule(printStyles(await exportedHtml(content)));

        expect(rule, 'the print stylesheet has a standalone svg rule').not.toBe('');
        expect(rule).toContain('display: block');
        expect(rule).toMatch(/margin:[^;]*auto[^;]*;/);
    });

    it('still centers a diagram carried as an image', async () => {
        const content = document.createElement('div');
        content.innerHTML = '<h1>Title</h1><p>An intro.</p>';

        const style = printStyles(await exportedHtml(content));
        const rule = style.match(/(^|\n)img \{[^}]*\}/)?.[0] ?? '';

        expect(rule, 'the print stylesheet has a standalone img rule').not.toBe('');
        expect(rule).toMatch(/margin:[^;]*auto[^;]*;/);
    });
});

describe('printMarkdownToPdf — a unified diagram on paper', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const styleOf = async (): Promise<string> => {
        const content = document.createElement('div');
        content.innerHTML = '<h1>Title</h1><p>An intro.</p>';
        return printStyles(await exportedHtml(content));
    };

    it('frames a diagram block on the white page', async () => {
        const style = await styleOf();
        expect(style).toContain('.code-block-wrapper.diagram-block');
        expect(style).toMatch(/\.code-block-wrapper\.diagram-block \{[^}]*background: white[^}]*\}/);
        expect(style).toMatch(/\.code-block-wrapper\.diagram-block \{[^}]*border: 1px solid[^}]*\}/);
    });

    it('lifts the code styling off the fence a diagram sits in', async () => {
        const style = await styleOf();
        expect(style).toContain('pre:has(> .code-block-wrapper.diagram-block)');
    });

    it('draws archdia on the print page with the unified box look', async () => {
        const style = await styleOf();
        expect(style).toContain('--diagram-box-fill: #e8eaf0;');
        expect(style).toMatch(/\.archdia-svg \{[^}]*--archdia-bg: var\(--bg\)[^}]*\}/);
        expect(style).toMatch(/\.archdia-svg \{[^}]*--archdia-box-border: var\(--muted\)[^}]*\}/);
    });

    it('gives mermaid the shared radius and line-text size', async () => {
        const style = await styleOf();
        expect(style).toMatch(/\.mermaid svg rect \{[^}]*rx: 8px[^}]*\}/);
        expect(style).toContain('.mermaid svg .messageText');
        expect(style).toMatch(/\.labelText \{[^}]*font-size: 14px !important[^}]*\}/);
    });
});
