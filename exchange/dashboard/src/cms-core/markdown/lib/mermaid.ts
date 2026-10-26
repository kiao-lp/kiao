import mermaid from 'mermaid';
import { kiaoMermaidTheme, type KiaoTheme } from 'kiao-style';

// Suppress Mermaid's error SVG; the caller displays the failure in the diagram block.
export function configureMermaid(theme: KiaoTheme): void {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: kiaoMermaidTheme(theme),
        securityLevel: 'loose',
        suppressErrorRendering: true,
        // Stable flowcharts honour this experimental option; padding is doubled horizontally.
        flowchart: {
            padding: 8,
        },
        // Sequence font options are overwritten by the theme; the preview stylesheet sizes labels.
    });
}

/* A fixed, clipped host prevents scrollbar flicker while measuring oversized diagrams.
 * Keep layout enabled: display:none gives Mermaid zero-sized labels. */
const HOST_STYLE = 'position:fixed;top:0;left:0;width:100%;height:0;'
    + 'overflow:hidden;visibility:hidden;pointer-events:none';

/* Use a host per render: Mermaid clears it, so concurrent renders must not share one.
 * Attach it to the document for renderers that look up their SVG by id. */
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

// Renderer chunks can disappear after a deployment; offer reload for import failures.
// Preserve Mermaid's diagnostic for invalid diagrams.
export function readMermaidFailure(error: unknown): MermaidFailure {
    const message = error instanceof Error ? error.message : String(error);
    // Match dynamic-import failures in Chrome, Firefox and Safari.
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
