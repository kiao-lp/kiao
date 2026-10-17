import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    DiagramTheme,
    THEME_DARK,
    resolveTheme,
} from '@cms-kit/diagram-shared';
import { parseGraphFile } from './graph-model';
import { runAlgorithms } from './graph-algorithms';
import {
    GraphSvgRenderer,
    computeGraphContentBounds,
    getNormalizedPositions,
} from '../components/GraphSvgRenderer';
import { GRAPH_CSS_VARS, getGraphExportStyleString } from './graph-styles';

/**
 * Render a Graph (.graph.json content) directly to a standalone SVG string,
 * suitable for Node.js usage. Mirrors archdia's `renderArchDiaToSvgString`.
 */
export async function renderGraphToSvgString(
    text: string,
    themeVars?: Partial<DiagramTheme>,
): Promise<string> {
    const parsed = parseGraphFile(text);
    const graph = runAlgorithms(parsed);

    const contentSize = computeGraphContentBounds(graph);
    const normalized = getNormalizedPositions(graph);
    const exportGraph = {
        ...graph,
        size: contentSize ?? graph.size,
        nodes: normalized
            ? graph.nodes.map(n => ({ ...n, ...(normalized[n.id] ?? {}) }))
            : graph.nodes,
    };

    const staticHtml = renderToStaticMarkup(
        <GraphSvgRenderer graph={exportGraph} />,
    );

    let source = staticHtml;
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }

    const resolvedTheme = resolveTheme(GRAPH_CSS_VARS, themeVars) ?? THEME_DARK;
    const bg = resolvedTheme.bg;
    const styleBlock = `<style>\n${getGraphExportStyleString(resolvedTheme)}\n</style>`;

    const viewBoxMatch = source.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : `0 0 ${exportGraph.size.width} ${exportGraph.size.height}`;
    const [vbX, vbY, vbW, vbH] = viewBox.split(/\s+|,/);
    const bgRect = `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bg}" />`;

    source = source.replace(/>/, `>\n${styleBlock}\n${bgRect}`);

    return '<?xml version="1.0" standalone="no"?>\r\n' + source;
}
