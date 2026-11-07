import mermaid from 'mermaid';
import { kiaoMermaidTheme, type KiaoTheme } from 'kiao-style';

// Suppress Mermaid's error SVG; the caller shows the failure.
export function configureMermaid(theme: KiaoTheme): void {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: kiaoMermaidTheme(theme),
        securityLevel: 'loose',
        suppressErrorRendering: true,
        // Padding is doubled horizontally by the renderer.
        flowchart: {
            padding: 8,
        },
    });
}

/* Fixed clipped host; layout stays enabled (display:none zeroes label sizes). */
const HOST_STYLE = 'position:fixed;top:0;left:0;width:100%;height:0;'
    + 'overflow:hidden;visibility:hidden;pointer-events:none';

/* One host per render: Mermaid clears it. Kept in the document for id lookups. */
export async function renderMermaidDiagram(id: string, code: string): Promise<string> {
    const host = document.createElement('div');
    host.setAttribute('style', HOST_STYLE);
    document.body.appendChild(host);
    try {
        const { svg } = await mermaid.render(id, code, host);
        return svg;
    } finally {
        host.remove();
    }
}

export interface MermaidFailure {
    /** `diagram`: invalid source; `renderer`: renderer module failed to load. */
    kind: 'diagram' | 'renderer';
    message: string;
}

// Import failures mean a stale deployment; diagram failures keep Mermaid's diagnostic.
export function readMermaidFailure(error: unknown): MermaidFailure {
    const message = error instanceof Error ? error.message : String(error);
    // Dynamic-import failure wording across browsers.
    if (/dynamically imported module|Importing a module script failed/i.test(message)) {
        return {
            kind: 'renderer',
            message:
                'The page is running a version of the application that is no longer on the server. '
                + 'Reload it to draw this diagram.',
        };
    }
    return { kind: 'diagram', message };
}
