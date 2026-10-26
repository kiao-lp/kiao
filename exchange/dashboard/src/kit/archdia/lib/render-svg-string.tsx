import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseArchDiaFile, getCombinedSource } from './archdia-parser';
import { plantumlExtractor } from './diagram-source';
import { ArchDiaSvgRenderer, computeContentBox } from '../components/ArchDiaSvgRenderer';
import { ArchDiaTheme, ARCHDIA_DARK, resolveArchDiaTheme } from './archdia-theme';
import { getArchDiaStyleString, getArchDiaExportStyleString } from './archdia-styles';
import { computeContainerBounds } from './container-bounds';
import { fitToContent } from './layout-operations';

/**
 * Render an ArchDia markdown string (PlantUML DSL + optionally JSON layout)
 * directly to a standalone SVG string, suitable for Node.js usage.
 *
 * @param text The .arch.md content
 * @param themeVars Optional color overrides for the diagram
 * @returns A promise resolving to the final SVG string
 */
export async function renderArchDiaToSvgString(
    text: string,
    themeVars?: Partial<ArchDiaTheme>
): Promise<string> {
    // 1. Parse file structure (blocks)
    // We do a preliminary parse to extract sources, then build the scene
    // from the combined PlantUML source.
    const emptyScene = { components: [], containers: [], relations: [] };
    const preliminary = await parseArchDiaFile(text, emptyScene);
    const combinedSource = getCombinedSource(preliminary);

    const components = plantumlExtractor.extractComponents(combinedSource);
    const containers = plantumlExtractor.extractContainers(combinedSource);
    const relations = plantumlExtractor.extractRelations(combinedSource);
    const scene = { components, containers, relations };

    // 2. Re-parse with the real scene so layout gets ensureAllPositions
    const archDiaFile = await parseArchDiaFile(text, scene);

    // 3. Crop the layout around its content for static export, the content moving with the crop so
    //    a diagram drawn away from the origin is not cut off on the right and the bottom.
    const cBounds = computeContainerBounds(containers, components, archDiaFile.layout.positions);
    const contentBox = computeContentBox(archDiaFile.layout.positions, components, cBounds);
    const exportLayout = contentBox
        ? fitToContent(archDiaFile, contentBox).layout
        : archDiaFile.layout;

    // 4. Render React component to static markup
    const staticHtml = renderToStaticMarkup(
        <ArchDiaSvgRenderer
            scene={scene}
            layout={exportLayout}
            descriptionsRaw={archDiaFile.descriptionsRaw}
        />
    );

    // 4. Wrap with the same CSS/XML structure as browser exports
    // We recreate a mock SVG Element to leverage serializeSvgForExport
    // Or we simply apply the text replacement since we don't have DOM in Node.

    // Actually, `serializeSvgForExport` relies on DOM (XMLSerializer, Element, document.documentElement).
    // Let's implement a Node-compatible wrapper here.

    let source = staticHtml;

    // Add required XML namespaces if not present
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }

    const resolvedTheme = resolveArchDiaTheme(themeVars);
    const bg = resolvedTheme.bg;
    const styleBlock = `<style>\n${getArchDiaExportStyleString(resolvedTheme)}\n</style>`;

    // Inject styles and background rect immediately after the opening <svg> tag
    const viewBoxMatch = source.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 1000 1000';
    const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+|,/);
    const bgRect = `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bg}" />`;

    // We look for the first ">" of the <svg tag
    source = source.replace(/>/, `>\n${styleBlock}\n${bgRect}`);

    // Add XML declaration
    return '<?xml version="1.0" standalone="no"?>\r\n' + source;
}
