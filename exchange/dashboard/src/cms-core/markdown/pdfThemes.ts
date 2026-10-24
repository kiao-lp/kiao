import type { WorkerClient } from 'kiao-worker';

export const PDF_THEMES_PATH = 'kiao-user-config/pdf-themes';

/** A store document supplies presentation only; its filename is the menu's stable key. */
export interface PdfTheme {
    id: string;
    label: string;
    variables?: Record<string, string>;
    css?: string;
    headerHtml?: string;
}

/** Also works with a worker that has not installed its default themes yet. */
export const DEFAULT_PDF_THEME: PdfTheme = { id: 'neutral', label: 'Default' };

export function parsePdfTheme(id: string, value: unknown): PdfTheme {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a theme object');
    const { label, variables, css, headerHtml } = value as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim()) throw new Error('Expected a theme label');
    if (variables !== undefined && (
        !variables || typeof variables !== 'object' || Array.isArray(variables)
        || Object.entries(variables).some(([key, value]) => !/^--[a-zA-Z][\w-]*$/.test(key) || typeof value !== 'string')
    )) throw new Error('Expected CSS custom properties with string values');
    if (css !== undefined && typeof css !== 'string') throw new Error('Expected CSS text');
    if (headerHtml !== undefined && typeof headerHtml !== 'string') throw new Error('Expected header HTML');
    return { id, label, variables: variables as PdfTheme['variables'], css, headerHtml };
}

/** Read on each menu opening so a copied or edited theme is immediately available. */
export async function loadPdfThemes(client: Pick<WorkerClient, 'listFiles' | 'getFileJson'>): Promise<PdfTheme[]> {
    let files;
    try {
        files = await client.listFiles(PDF_THEMES_PATH);
    } catch {
        return [DEFAULT_PDF_THEME];
    }
    const loaded = await Promise.all(files
        .filter(file => !file.isDirectory && file.path.endsWith('.json'))
        .map(async file => {
            try {
                const id = file.path.slice(file.path.lastIndexOf('/') + 1, -5);
                // Last-Modified has second precision; a quick edit must not reuse a cached 304.
                return parsePdfTheme(id, await client.getFileJson<unknown>(file.path, { cache: 'no-store' }));
            } catch (error) {
                console.warn(`[pdf-themes] ${file.path} could not be loaded`, error);
                return null;
            }
        }));
    const themes = new Map<string, PdfTheme>([[DEFAULT_PDF_THEME.id, DEFAULT_PDF_THEME]]);
    for (const theme of loaded) if (theme) themes.set(theme.id, theme);
    return [...themes.values()].sort((a, b) => {
        if (a.id === 'neutral') return -1;
        if (b.id === 'neutral') return 1;
        return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
}

export function buildPdfThemeCss(theme?: PdfTheme): string {
    const variables = Object.entries(theme?.variables ?? {}).map(([key, value]) => `    ${key}: ${value};`).join('\n');
    return `${variables ? `:root {\n${variables}\n}\n` : ''}${theme?.css ?? ''}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

/** Replace in one pass: a title containing a placeholder must remain literal. */
export function renderPdfThemeHeader(theme: PdfTheme | undefined, title: string, date = new Date()): string {
    return (theme?.headerHtml ?? '').replace(/\{\{(title|date)\}\}/g, (_, key: 'title' | 'date') =>
        escapeHtml(key === 'title' ? title : date.toLocaleDateString('en-GB')));
}
