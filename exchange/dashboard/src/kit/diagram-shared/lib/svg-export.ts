import { DiagramTheme, CssVarNames, resolveTheme } from './theme';

/** Standalone SVG with baked-in styles and a solid background. `themeVars` overrides the resolved theme values. */
export function serializeSvgForExport(
    svgElement: Element,
    cssVars: CssVarNames,
    getExportCss: (theme: DiagramTheme) => string,
    themeVars?: Partial<DiagramTheme>,
): string {
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgElement);

    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }

    const resolvedTheme = resolveTheme(cssVars, themeVars, svgElement);
    const bg = resolvedTheme.bg;
    const styleBlock = `<style>\n${getExportCss(resolvedTheme)}\n</style>`;

    const viewBox = svgElement.getAttribute('viewBox') || '0 0 1000 1000';
    const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+|,/);
    const bgRect = `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bg}" />`;

    source = source.replace(/>/, `>\n${styleBlock}\n${bgRect}`);

    return '<?xml version="1.0" standalone="no"?>\r\n' + source;
}

export function downloadFile(content: string, fileName: string, mimeType = 'image/svg+xml') {
    const url = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
