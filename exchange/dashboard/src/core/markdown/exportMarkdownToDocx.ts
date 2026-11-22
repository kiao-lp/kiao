import type { PdfTheme } from './pdfThemes';

export interface MarkdownDocxOptions {
    title: string;
    /** Host-provided: authenticated, document-relative loading. */
    loadResource: (url: string) => Promise<Blob>;
    plantUmlServerUrl?: string;
    onProgress?: (message: string) => void;
    /** Only the palette translates to Word (see `resolveWordTheme`); CSS/header stay PDF-only. */
    theme?: PdfTheme;
}

/** Lazy, browser-only OOXML generation. No store writes, no preview DOM. */
export async function exportMarkdownToDocx(source: string, options: MarkdownDocxOptions): Promise<Blob> {
    const { generateMarkdownDocx } = await import('./generateMarkdownDocx');
    return generateMarkdownDocx(source, options);
}
