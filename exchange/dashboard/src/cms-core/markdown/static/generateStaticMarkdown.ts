import type { KiaoTheme } from 'kiao-style';
import { findDiagramBlocks, replaceBlocks, type DiagramLanguage } from './fences';
import { prepareDiagramSvg } from './prepareDiagramSvg';

export type { DiagramBlock, DiagramLanguage } from './fences';
export { DIAGRAM_LANGUAGES, findDiagramBlocks, replaceBlocks } from './fences';
export { withIntrinsicSize } from './intrinsicSize';

/** Alt-text label per language. */
const DIAGRAM_LABELS: Record<DiagramLanguage, string> = {
    mermaid: 'Mermaid diagram',
    plantuml: 'PlantUML diagram',
    archdia: 'ArchDia diagram',
    graph: 'Graph diagram',
    svg: 'SVG image',
};

export interface StaticDiagramAsset {
    /** File name in the asset folder, e.g. `01-mermaid.svg`. */
    name: string;
    svg: string;
}

/** Failed diagram; its source stays in the output. */
export interface StaticDiagramFailure {
    language: DiagramLanguage;
    /** 1-based position; also the asset number. */
    position: number;
    message: string;
}

export interface StaticMarkdownResult {
    markdown: string;
    assets: StaticDiagramAsset[];
    failures: StaticDiagramFailure[];
}

export interface GenerateStaticMarkdownOptions {
    /** Asset folder relative to the file, used verbatim in links. Empty: beside the file. */
    assetFolder: string;
    /** Light by default for readability on white. */
    theme?: KiaoTheme;
    plantUmlServerUrl?: string;
    onProgress?: (done: number, total: number) => void;
}

/** Escapes `[`/`]` so alt text cannot close the image. */
const escapeAlt = (text: string): string => text.replace(/([[\]])/g, '\\$1');

/** Percent-encodes a path segment; `(` and `)` must not end the link destination. */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Replaces every diagram with an image link. Writes nothing; failures keep their source and are reported. */
export async function generateStaticMarkdown(
    markdown: string,
    options: GenerateStaticMarkdownOptions,
): Promise<StaticMarkdownResult> {
    const { assetFolder, theme = 'light', plantUmlServerUrl = import.meta.env.VITE_PLANTUML_SERVER_URL, onProgress } = options;

    const blocks = findDiagramBlocks(markdown);
    const assets: StaticDiagramAsset[] = [];
    const failures: StaticDiagramFailure[] = [];
    const replacements: (string | null)[] = [];

    // At least two digits so assets sort in document order.
    const width = Math.max(2, String(blocks.length).length);

    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const position = index + 1;
        try {
            const svg = await prepareDiagramSvg(block.language, block.code, {
                theme,
                plantUmlServerUrl,
            });
            const name = `${String(position).padStart(width, '0')}-${block.language}.svg`;
            assets.push({ name, svg });

            const href = [...assetFolder.split('/').filter(Boolean), name].map(encodeSegment).join('/');
            replacements.push(`![${escapeAlt(`${DIAGRAM_LABELS[block.language]} ${position}`)}](${href})`);
        } catch (error) {
            failures.push({
                language: block.language,
                position,
                message: error instanceof Error ? error.message : String(error),
            });
            replacements.push(null);
        }
        onProgress?.(position, blocks.length);
    }

    return { markdown: replaceBlocks(markdown, blocks, replacements), assets, failures };
}
