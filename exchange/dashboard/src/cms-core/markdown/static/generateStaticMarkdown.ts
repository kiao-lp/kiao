import type { KiaoTheme } from 'kiao-style';
import { findDiagramBlocks, replaceBlocks, type DiagramLanguage } from './fences';
import { prepareDiagramSvg } from './prepareDiagramSvg';

export type { DiagramBlock, DiagramLanguage } from './fences';
export { DIAGRAM_LANGUAGES, findDiagramBlocks, replaceBlocks } from './fences';
export { withIntrinsicSize } from './intrinsicSize';

/** How each language names itself in the alt text of the image it becomes. */
const DIAGRAM_LABELS: Record<DiagramLanguage, string> = {
    mermaid: 'Mermaid diagram',
    plantuml: 'PlantUML diagram',
    archdia: 'ArchDia diagram',
    graph: 'Graph diagram',
    svg: 'SVG image',
};

/** One picture to be written beside the generated markdown. */
export interface StaticDiagramAsset {
    /** File name within the asset folder, e.g. `01-mermaid.svg`. */
    name: string;
    svg: string;
}

/** A diagram that could not be drawn. Its source is kept in the generated file. */
export interface StaticDiagramFailure {
    language: DiagramLanguage;
    /** 1-based position among the document's diagram blocks — the number in the asset names. */
    position: number;
    message: string;
}

export interface StaticMarkdownResult {
    /** The generated markdown, with every drawn diagram replaced by a link to its picture. */
    markdown: string;
    assets: StaticDiagramAsset[];
    failures: StaticDiagramFailure[];
}

export interface GenerateStaticMarkdownOptions {
    /**
     * Folder the pictures are written to, named relative to the generated markdown file and used
     * verbatim in the image links. Empty puts them beside the file.
     */
    assetFolder: string;
    /**
     * Palette the diagrams are drawn in. Light by default: the generated file is meant to be read
     * wherever markdown is read, and a diagram drawn for a dark application is unreadable on the
     * white background every one of those places has.
     */
    theme?: KiaoTheme;
    /** The PlantUML server diagrams are fetched from — the deployment's own by default. */
    plantUmlServerUrl?: string;
    /** Called after each diagram, so a long document can say where it is. */
    onProgress?: (done: number, total: number) => void;
}

/** `!` and `[` in an alt text would close the image early; nothing else in it can hurt. */
const escapeAlt = (text: string): string => text.replace(/([[\]])/g, '\\$1');

/**
 * Percent-encodes one path segment for a markdown link. `encodeURIComponent` leaves `(` and `)`
 * alone, and either of them ends the link's destination — a folder named `Design (v2).assets`
 * would otherwise produce a broken image and no error anywhere.
 */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * Turns a markdown source into its static twin: the same document, with every diagram replaced by
 * a link to a picture of it.
 *
 * Nothing is written here. The caller is handed the markdown and the pictures and decides where
 * they go, which is what keeps this function testable and lets the same engine serve a browser
 * writing through the file store and, one day, a build script writing to disk.
 *
 * A diagram that fails to draw keeps its fenced source in the output and is reported in
 * `failures`. That is the only honest outcome: a hole where a diagram was would lose the content,
 * and an error page baked into a document would hide the loss behind something that looks
 * deliberate.
 */
export async function generateStaticMarkdown(
    markdown: string,
    options: GenerateStaticMarkdownOptions,
): Promise<StaticMarkdownResult> {
    const { assetFolder, theme = 'light', plantUmlServerUrl = import.meta.env.VITE_PLANTUML_SERVER_URL, onProgress } = options;

    const blocks = findDiagramBlocks(markdown);
    const assets: StaticDiagramAsset[] = [];
    const failures: StaticDiagramFailure[] = [];
    const replacements: (string | null)[] = [];

    // Two digits so ten diagrams still sort in document order in a file browser; more than
    // ninety-nine simply grows the number rather than colliding.
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
