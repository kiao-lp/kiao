import { isMap, parseDocument, YAMLMap } from 'yaml';

export const MARKDOWN_STATUSES = ['DRAFT', 'EXPERIMENTAL', 'APPROVED'] as const;
export const MARKDOWN_ROLES = ['PRIMARY_SOURCE', 'DERIVED'] as const;

export type MarkdownStatus = typeof MARKDOWN_STATUSES[number];
export type MarkdownRole = typeof MARKDOWN_ROLES[number];
export interface MarkdownMetadataPatch {
    status?: MarkdownStatus;
    role?: MarkdownRole;
    provenance?: string;
}

// Only a fenced header at the start is metadata. Keep the body and delimiters verbatim,
// including the BOM and CRLFs; horizontal rules elsewhere belong to the Markdown body.
const FRONTMATTER = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m;

export function readMarkdownMetadata(source: string) {
    const match = FRONTMATTER.exec(source);
    // The multiline flag is needed for the closing fence, but must not match a later opening.
    const header = match?.index === 0 ? match : null;
    const document = parseDocument(header?.[2] ?? '');
    let error = document.errors.length > 0
        ? 'Fix the YAML header in the source pane to edit metadata.'
        : document.contents !== null && !isMap(document.contents)
            ? 'The YAML header must contain a mapping to edit metadata.'
            : undefined;
    if (!error) {
        try {
            // Unresolved aliases can parse without errors but cannot be written back safely.
            document.toString();
        } catch {
            error = 'Fix the YAML header in the source pane to edit metadata.';
        }
    }
    const docNode = !error && isMap(document.contents)
        ? document.contents.get('document', true)
        : undefined;
    if (!error && docNode !== undefined && !isMap(docNode)
        && (docNode as { value?: unknown }).value !== null) {
        error = 'Fix the YAML header in the source pane to edit metadata.';
    }

    const text = (key: string): string | undefined => {
        if (error) return undefined;
        const value: unknown = document.getIn(['document', key]);
        return typeof value === 'string' ? value : undefined;
    };

    return {
        status: text('status'),
        role: text('role'),
        provenance: text('provenance') ?? '',
        error,
        update(patch: MarkdownMetadataPatch): string {
            if (error) throw new Error(error);
            if (docNode !== undefined && !isMap(docNode)) document.set('document', new YAMLMap());
            for (const [key, value] of Object.entries(patch)) document.setIn(['document', key], value);
            const newline = source.includes('\r\n') ? '\r\n' : '\n';
            const yaml = document.toString({ lineWidth: 0 }).replace(/\n/g, newline);
            if (header) {
                return header[1] + yaml + header[3] + source.slice(header[0].length);
            }
            const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
            return `${bom}---${newline}${yaml}---${newline}${newline}${source.slice(bom.length)}`;
        },
    };
}
