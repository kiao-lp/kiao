import { describe, expect, it, vi } from 'vitest';
import { buildPdfThemeCss, DEFAULT_PDF_THEME, loadPdfThemes, parsePdfTheme, PDF_THEMES_PATH, renderPdfThemeHeader } from './pdfThemes';

describe('store PDF themes', () => {
    it('keeps neutral export available when the folder is absent', async () => {
        const client = { listFiles: vi.fn().mockRejectedValue(new Error('missing')), getFileJson: vi.fn() };
        expect(await loadPdfThemes(client)).toEqual([DEFAULT_PDF_THEME]);
        expect(client.listFiles).toHaveBeenCalledWith(PDF_THEMES_PATH);
    });

    it('loads custom themes, isolates invalid files, and reads edits on the next opening', async () => {
        const docs: Record<string, unknown> = {
            'neutral.json': { label: 'Plain', variables: { '--heading-1': '#111' } },
            'custom.json': { label: 'Company', css: 'h1 { color: blue; }' },
            'bad.json': { label: 'Broken', variables: { color: 4 } },
        };
        const client = {
            listFiles: vi.fn().mockResolvedValue([
                ...Object.keys(docs).map(name => ({ path: `${PDF_THEMES_PATH}/${name}`, isDirectory: false })),
                { path: `${PDF_THEMES_PATH}/README.md`, isDirectory: false },
                { path: `${PDF_THEMES_PATH}/folder.json`, isDirectory: true },
            ]),
            getFileJson: vi.fn(async (path: string) => docs[path.split('/').pop()!]) as never,
        };
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const themes = await loadPdfThemes(client);
            expect(client.getFileJson).toHaveBeenCalledWith(`${PDF_THEMES_PATH}/custom.json`, { cache: 'no-store' });
            expect(themes.map(theme => [theme.id, theme.label])).toEqual([['neutral', 'Plain'], ['custom', 'Company']]);
            expect(buildPdfThemeCss(themes[0])).toContain('--heading-1: #111;');
            docs['custom.json'] = { label: 'Updated', headerHtml: '<header>{{title}}</header>' };
            expect((await loadPdfThemes(client))[1].label).toBe('Updated');
            expect(warning).toHaveBeenCalledTimes(2);
        } finally {
            warning.mockRestore();
        }
    });

    it('escapes header substitutions without interpreting placeholders inside the title', () => {
        const theme = parsePdfTheme('custom', { label: 'Custom', headerHtml: '<header>{{title}} — {{date}}</header>' });
        expect(renderPdfThemeHeader(theme, 'A&B <img> "{{date}}"', new Date(2026, 9, 15)))
            .toBe('<header>A&amp;B &lt;img&gt; &quot;{{date}}&quot; — 15/10/2026</header>');
        expect(renderPdfThemeHeader(undefined, 'No header')).toBe('');
    });
});
