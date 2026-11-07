import { serializeSvgForExport as sharedSerialize, downloadFile } from '@cms-kit/diagram-shared';
import { ArchDiaTheme, ARCHDIA_CSS_VARS } from './archdia-theme';
import { getArchDiaExportStyleString } from './archdia-styles';

/**
 * Serialize the current archdia SVG element into a standalone SVG string
 * with baked-in styles and a solid background — ready for export/download.
 */
export function serializeSvgForExport(
    svgElement: Element,
    themeVars?: Partial<ArchDiaTheme>,
): string {
    return sharedSerialize(svgElement, ARCHDIA_CSS_VARS, getArchDiaExportStyleString, themeVars);
}

export { downloadFile };
