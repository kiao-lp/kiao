import { prepareSvg, type PrepareSvgOptions } from '../lib/clipboard';
import { withIntrinsicSize } from './intrinsicSize';
import { renderDiagramToSvg, type RenderDiagramOptions } from './renderDiagramToSvg';
import type { DiagramLanguage } from './fences';

/** The in-memory preparation shared by file exports and Word. Mermaid uses the shared queue. */
export async function prepareDiagramSvg(
    language: DiagramLanguage,
    code: string,
    options: RenderDiagramOptions & PrepareSvgOptions,
): Promise<string> {
    const rendered = await renderDiagramToSvg(language, code, options);
    return withIntrinsicSize(await prepareSvg(rendered, options));
}
