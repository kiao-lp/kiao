import { serializeSvgForExport as sharedSerialize, downloadFile, DiagramTheme } from '@cms-kit/diagram-shared';
import { GRAPH_CSS_VARS } from './graph-styles';
import { getGraphExportStyleString } from './graph-styles';

/**
 * Serialize the current graph SVG element into a standalone SVG string
 * with baked-in styles and a solid background — ready for export/download.
 */
export function serializeSvgForExport(
    svgElement: Element,
    themeVars?: Partial<DiagramTheme>,
): string {
    return sharedSerialize(svgElement, GRAPH_CSS_VARS, getGraphExportStyleString, themeVars);
}

export { downloadFile };
