import { serializeSvgForExport as sharedSerialize, downloadFile, DiagramTheme } from '@cms-kit/diagram-shared';
import { GRAPH_CSS_VARS } from './graph-styles';
import { getGraphExportStyleString } from './graph-styles';

export function serializeSvgForExport(
    svgElement: Element,
    themeVars?: Partial<DiagramTheme>,
): string {
    return sharedSerialize(svgElement, GRAPH_CSS_VARS, getGraphExportStyleString, themeVars);
}

export { downloadFile };
