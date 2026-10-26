import type { PdfTheme } from './pdfThemes';

export interface MarkdownDocxOptions {
    title: string;
    /** Authenticated store access and document-relative resolution belong to the editor host. */
    loadResource: (url: string) => Promise<Blob>;
    plantUmlServerUrl?: string;
    onProgress?: (message: string) => void;
    /**
     * Store theme for the generated document. Only its palette translates to
     * native Word formatting (see `resolveWordTheme`); its CSS and header HTML
     * stay PDF-only. Omitted, the neutral native style is used.
     */
    theme?: PdfTheme;
}

/** Lazy browser-only OOXML generation. No store writes and no dependency on a preview DOM. */
export async function exportMarkdownToDocx(source: string, options: MarkdownDocxOptions): Promise<Blob> {
    const { generateMarkdownDocx } = await import('./generateMarkdownDocx');
    return generateMarkdownDocx(source, options);
}
