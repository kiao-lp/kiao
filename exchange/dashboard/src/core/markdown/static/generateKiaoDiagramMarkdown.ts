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

export interface KiaoDiagramAsset {
    /** File name in the asset folder, e.g. `01-mermaid.svg`. */
    name: string;
    svg: string;
}

/** Failed diagram; its block stays untouched. */
export interface KiaoDiagramFailure {
    language: DiagramLanguage;
    /** 1-based position; also the asset number. */
    position: number;
    message: string;
}

export interface KiaoDiagramResult {
    markdown: string;
    assets: KiaoDiagramAsset[];
    failures: KiaoDiagramFailure[];
}

export interface GenerateKiaoDiagramOptions {
    /** Asset folder relative to the file, used verbatim in links. Empty: beside the file. */
    assetFolder: string;
    /** Light by default for readability on white. */
    theme?: KiaoTheme;
    plantUmlServerUrl?: string;
    onProgress?: (done: number, total: number) => void;
}

/** Percent-encodes a path segment; `(` and `)` must not end the link destination. */
const encodeSegment = (segment: string): string =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Wraps every diagram as a `kiao:diagram` block. Writes nothing; failures keep their block and are reported. */
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

/** `docs/Design.md` -> `docs/Design.assets/`. `.src.md` has no target. */
export interface DiagramAssetTarget {
    source: string;
    /** Folder name used in image links. */
    assetFolder: string;
    /** Same folder as a store path. */
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
