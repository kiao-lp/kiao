import plantumlEncoder from 'plantuml-encoder';
import { kiaoPlantUMLTheme, themeMode, injectPlantUMLTheme, type KiaoTheme } from 'kiao-style';
import { configureMermaid, renderMermaidDiagram } from '../lib/mermaid';
import type { DiagramLanguage } from './fences';

const DEFAULT_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml';

export interface RenderDiagramOptions {
    theme: KiaoTheme;
    plantUmlServerUrl?: string;
}

/**
 * Mermaid renders through the one document it is initialized against, and its teardown removes
 * elements by id — two renders in flight let one delete the other's working node. A document's
 * diagrams are therefore drawn one after another, which also makes progress reporting mean
 * something.
 */
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

    // The SVG is fetched rather than linked: a static file that still points at a render server is
    // not static, and the server it points at is a deployment detail that outlives no document.
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`PlantUML server answered ${response.status}`);
    const svg = await response.text();
    if (!svg.includes('</svg>')) throw new Error('PlantUML server returned no SVG');
    return svg;
}

/**
 * Draws one diagram to a standalone SVG string.
 *
 * archdia and graph are imported on demand, and their string renderers rather than their React
 * components are used: those already auto-fit the drawing to its content and inline the theme's
 * stylesheet, which is precisely what a picture leaving the application needs and what an artboard
 * sized to a viewport does not give.
 */
export async function renderDiagramToSvg(
    language: DiagramLanguage,
    code: string,
    options: RenderDiagramOptions,
): Promise<string> {
    switch (language) {
        case 'svg':
            // Already a picture. The author wrote the markup; it travels as written.
            return code.trim();

        case 'mermaid':
            return renderMermaid(code, options.theme);

        case 'plantuml':
            return renderPlantUml(code, options);

        case 'archdia': {
            const { renderArchDiaToSvgString, ARCHDIA_LIGHT, ARCHDIA_DARK } = await import('@cms-kit/archdia');
            const base = themeMode(options.theme) === 'dark' ? ARCHDIA_DARK : ARCHDIA_LIGHT;
            // A static export is read, never edited: boxes carry the unified outline.
            return renderArchDiaToSvgString(code, { ...base, boxBorder: base.muted });
        }

        case 'graph': {
            // graph shares the theme shape but ships no palette of its own; archdia's
            // are the ones both renderers are drawn with. It has two, so a sober theme is drawn
            // at its own brightness.
            const [{ renderGraphToSvgString }, { ARCHDIA_LIGHT, ARCHDIA_DARK }] = await Promise.all([
                import('@cms-kit/graph'),
                import('@cms-kit/archdia'),
            ]);
            const base = themeMode(options.theme) === 'dark' ? ARCHDIA_DARK : ARCHDIA_LIGHT;
            return renderGraphToSvgString(code, { ...base, boxBorder: base.muted });
        }
    }
}
