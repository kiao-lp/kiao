import plantumlEncoder from 'plantuml-encoder';
import { kiaoPlantUMLTheme, themeMode, injectPlantUMLTheme, type KiaoTheme } from 'kiao-style';
import { configureMermaid, renderMermaidDiagram } from '../lib/mermaid';
import type { DiagramLanguage } from './fences';

const DEFAULT_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml';

export interface RenderDiagramOptions {
    theme: KiaoTheme;
    plantUmlServerUrl?: string;
}

/** Serialized: concurrent Mermaid renders delete each other's nodes. */
let mermaidQueue: Promise<unknown> = Promise.resolve();
let mermaidSequence = 0;

function serializeMermaid<T>(work: () => Promise<T>): Promise<T> {
    const result = mermaidQueue.then(work, work);
    mermaidQueue = result.catch(() => undefined);
    return result;
}

async function renderMermaid(code: string, theme: KiaoTheme): Promise<string> {
    return serializeMermaid(async () => {
        configureMermaid(theme);
        return renderMermaidDiagram(`markdown-static-${++mermaidSequence}`, code);
    });
}

async function renderPlantUml(code: string, options: RenderDiagramOptions): Promise<string> {
    const themed = injectPlantUMLTheme(code.trim(), kiaoPlantUMLTheme(options.theme));
    const base = (options.plantUmlServerUrl || DEFAULT_PLANTUML_SERVER).replace(/\/$/, '');
    const url = `${base}/svg/${plantumlEncoder.encode(themed)}`;

    // Fetched, not linked: static files must not point at a render server.
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`PlantUML server answered ${response.status}`);
    const svg = await response.text();
    if (!svg.includes('</svg>')) throw new Error('PlantUML server returned no SVG');
    return svg;
}

/** String renderers auto-fit and inline the theme. */
export async function renderDiagramToSvg(
    language: DiagramLanguage,
    code: string,
    options: RenderDiagramOptions,
): Promise<string> {
    switch (language) {
        case 'svg':
            return code.trim();

        case 'mermaid':
            return renderMermaid(code, options.theme);

        case 'plantuml':
            return renderPlantUml(code, options);

        case 'archdia': {
            const { renderArchDiaToSvgString, ARCHDIA_LIGHT, ARCHDIA_DARK } = await import('@kiao-dashboard-kit/archdia');
            const base = themeMode(options.theme) === 'dark' ? ARCHDIA_DARK : ARCHDIA_LIGHT;
            return renderArchDiaToSvgString(code, { ...base, boxBorder: base.muted });
        }

        case 'graph': {
            const [{ renderGraphToSvgString }, { ARCHDIA_LIGHT, ARCHDIA_DARK }] = await Promise.all([
                import('@kiao-dashboard-kit/graph'),
                import('@kiao-dashboard-kit/archdia'),
            ]);
            const base = themeMode(options.theme) === 'dark' ? ARCHDIA_DARK : ARCHDIA_LIGHT;
            return renderGraphToSvgString(code, { ...base, boxBorder: base.muted });
        }
    }
}
