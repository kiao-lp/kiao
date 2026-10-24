import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateMarkdownDocx } from './generateMarkdownDocx';
import type { PdfTheme } from './pdfThemes';

async function documentPackage(source: string, theme?: PdfTheme) {
    const blob = await generateMarkdownDocx(source, {
        title: 'anchors',
        theme,
        loadResource: async (src) => { throw new Error(`Unexpected resource: ${src}`); },
    });
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
    const zip = await JSZip.loadAsync(buffer);
    return {
        document: await zip.file('word/document.xml')!.async('string'),
        styles: await zip.file('word/styles.xml')!.async('string'),
        rels: await zip.file('word/_rels/document.xml.rels')!.async('string'),
    };
}

async function documentParts(source: string) {
    const { document, rels } = await documentPackage(source);
    return { document, rels };
}

describe('word anchor links', () => {
    it('exports #links as internal hyperlinks to heading bookmarks', async () => {
        const { document, rels } = await documentParts('# Context\n\n[Go to context](#context)\n');
        expect(document).toContain('w:anchor="context"');
        expect(document).toContain('w:name="context"');
        expect(rels).not.toContain('#context');
    });

    it('keeps external links as external relationships', async () => {
        const { rels } = await documentParts('[Outside](https://example.com/a?b=1&c=2)\n');
        expect(rels).toContain('https://example.com/a?b=1&amp;c=2');
    });

    it('surrounds headings with space before and after while keeping them with the next paragraph', async () => {
        const { document } = await documentParts('# Titre\n\nParagraphe.\n\n## Sous-titre\n');
        expect(document).toContain('w:val="Heading1"');
        expect(document).toContain('w:val="Heading2"');
        expect(document).toContain('w:keepNext');
        expect(document.match(/w:before="240"/g)).toHaveLength(2);
        expect(document).toContain('w:after="120"');
    });
});

describe('word theme palette', () => {
    const theme: PdfTheme = {
        id: 'company',
        label: 'Company',
        variables: {
            '--text': '#111111',
            '--heading-1': '#174a7e',
            '--link': '#ff0000',
            '--quote-bar': '#00ff00',
            '--accent-bg': '#0000ff',
            '--input-bg': '#ffff00',
            '--hr-color': '#123456',
        },
    };
    const source = '# Titre\n\n[Outside](https://example.com)\n\n> Citation\n\n| Nom |\n| --- |\n| x |\n\n```ts\ncode\n```\n\n---\n';

    it('paints native Word formatting with the theme palette', async () => {
        const { document, styles } = await documentPackage(source, theme);
        expect(document).toContain('w:val="174A7E"');
        expect(document).toContain('w:val="FF0000"');
        expect(document).toContain('w:color="00FF00"');
        expect(document).toContain('w:fill="0000FF"');
        expect(document).toContain('w:color="123456"');
        expect(styles).toContain('w:val="111111"');
        expect(styles).toContain('w:fill="FFFF00"');
    });

    it('keeps the neutral native style without a theme', async () => {
        const { document, styles } = await documentPackage(source);
        expect(document).toContain('w:color="999999"');
        expect(document).toContain('w:fill="F0F0F0"');
        expect(document).not.toContain('174A7E');
        expect(document).not.toContain('FF0000');
        expect(document).not.toContain('00FF00');
        expect(document).not.toContain('0000FF');
        expect(document).not.toContain('123456');
        expect(styles).toContain('1A1A1A');
        expect(styles).toContain('F5F5F5');
        expect(styles).not.toContain('111111');
        expect(styles).not.toContain('FFFF00');
    });
});
