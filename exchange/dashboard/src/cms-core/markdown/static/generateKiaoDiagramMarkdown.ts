import type { KiaoTheme } from 'kiao-style';
import {
    findKiaoDiagramTargets,
    replaceKiaoTargets,
    formatKiaoDiagramBlock,
    type KiaoDiagramTarget,
} from './kiaoDiagram';
import type { DiagramLanguage } from './fences';
import { prepareDiagramSvg } from './prepareDiagramSvg';

export type { KiaoDiagramTarget };
export {
    findKiaoDiagramTargets,
    replaceKiaoTargets,
    formatKiaoDiagramBlock,
    KIAO_DIAGRAM_LABELS,
    escapeKiaoDiagramCode,
    unescapeKiaoDiagramCode,
    isKiaoDiagramRange,
} from './kiaoDiagram';

/** One picture to be written beside the markdown file. */
export interface KiaoDiagramAsset {
    /** File name within the asset folder, e.g. `01-mermaid.svg`. */
    name: string;
    svg: string;
}

/** A diagram that could not be drawn. Its block is left untouched. */
export interface KiaoDiagramFailure {
    language: DiagramLanguage;
    /** 1-based position among the document's diagrams — the number in the asset names. */
    position: number;
    message: string;
}

export interface KiaoDiagramResult {
    /** The markdown with every drawn diagram wrapped in its comment + picture. */
    markdown: string;
    assets: KiaoDiagramAsset[];
    failures: KiaoDiagramFailure[];
}

export interface GenerateKiaoDiagramOptions {
    /**
     * Folder the pictures are written to, named relative to the markdown file and used
     * verbatim in the image links. Empty puts them beside the file.
     */
    assetFolder: string;
    /**
     * Palette the diagrams are drawn in. Light by default: the pictures are meant to be read
     * wherever markdown is read, and a diagram drawn for a dark application is unreadable on the
     * white background every one of those places has.
     */
    theme?: KiaoTheme;
    /** The PlantUML server diagrams are fetched from — the deployment's own by default. */
    plantUmlServerUrl?: string;
    /** Called after each diagram, so a long document can say where it is. */
    onProgress?: (done: number, total: number) => void;
}

/**
 * Percent-encodes one path segment for a markdown link. `encodeURIComponent` leaves `(` and `)`
 * alone, and either of them ends the link's destination.
 */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * Turns every diagram of a markdown source into its `kiao:diagram` block: the source in an HTML
 * comment GitHub hides, the pre-rendered picture right after it.
 *
 * Nothing is written here. The caller is handed the markdown and the pictures and decides where
 * they go, which is what keeps this function testable and lets the same engine serve a browser
 * writing through the file store.
 *
 * A diagram that fails to draw keeps its block untouched and is reported in `failures` — a hole
 * where a diagram was would lose the content, and an error page baked into a document would hide
 * the loss behind something that looks deliberate.
 */
export async function generateKiaoDiagramMarkdown(
    markdown: string,
    options: GenerateKiaoDiagramOptions,
): Promise<KiaoDiagramResult> {
    const { assetFolder, theme = 'light', plantUmlServerUrl = import.meta.env.VITE_PLANTUML_SERVER_URL, onProgress } = options;

    const targets = findKiaoDiagramTargets(markdown);
    const assets: KiaoDiagramAsset[] = [];
    const failures: KiaoDiagramFailure[] = [];
    const replacements: (string | null)[] = [];

    const width = Math.max(2, String(targets.length).length);

    for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        const position = index + 1;
        try {
            const svg = await prepareDiagramSvg(target.language, target.code, {
                theme,
                plantUmlServerUrl,
            });
            const name = `${String(position).padStart(width, '0')}-${target.language}.svg`;
            assets.push({ name, svg });

            const href = [...assetFolder.split('/').filter(Boolean), name].map(encodeSegment).join('/');
            replacements.push(formatKiaoDiagramBlock(target.language, target.code, href, position));
        } catch (error) {
            failures.push({
                language: target.language,
                position,
                message: error instanceof Error ? error.message : String(error),
            });
            replacements.push(null);
        }
        onProgress?.(position, targets.length);
    }

    return { markdown: replaceKiaoTargets(markdown, targets, replacements), assets, failures };
}

/**
 * Where a markdown file's diagram pictures go.
 *
 * A `.md` renders its diagrams beside itself, in a folder named after it: `docs/Design.md`
 * draws into `docs/Design.assets/`, linked as `Design.assets/01-….svg`. That convention is the
 * whole contract — no index, no manifest — so a document and its pictures survive being renamed,
 * moved or copied together by anything that moves files.
 *
 * A `.src.md` names no target: it already declares a generated twin through the static-version
 * flow, and rendering diagrams in place would hide its fences from that flow.
 */
export interface DiagramAssetTarget {
    /** The `.md` file, as given. */
    source: string;
    /** Folder holding the pictures, named relative to `source` — what goes in the image links. */
    assetFolder: string;
    /** That same folder, as a path in the store. */
    assetFolderPath: string;
}

export const diagramAssetTarget = (source: string): DiagramAssetTarget | null => {
    const lower = source.toLowerCase();
    if (!lower.endsWith('.md') || lower.endsWith('.src.md')) return null;

    const stem = source.slice(0, -'.md'.length);
    const base = stem.slice(stem.lastIndexOf('/') + 1);
    if (!base) return null;

    return {
        source,
        assetFolder: `${base}.assets`,
        assetFolderPath: `${stem}.assets`,
    };
};
