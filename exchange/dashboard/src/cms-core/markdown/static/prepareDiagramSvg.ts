import { prepareSvg, type PrepareSvgOptions } from '../../ui-foundation/clipboard/svgClipboard';
import { withIntrinsicSize } from './intrinsicSize';
import type { RenderDiagramOptions } from './renderDiagramToSvg';
import type { DiagramLanguage } from './fences';

export async function prepareDiagramSvg(
    language: DiagramLanguage,
    code: string,
    options: RenderDiagramOptions & PrepareSvgOptions,
): Promise<string> {
    const { renderDiagramToSvg } = await import('./renderDiagramToSvg');
    const rendered = await renderDiagramToSvg(language, code, options);
    return withIntrinsicSize(await prepareSvg(rendered, options));
}
