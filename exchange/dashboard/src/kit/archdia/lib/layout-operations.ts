import { ArchDiaFile, ArchDiaLayout, DiagramScene } from './archdia-model';
import { getCombinedSource, parseArchDiaFile } from './archdia-parser';
import { computePlantUmlLayout } from './plantuml-layout';
import { computeTreemapLayout } from './treemap-layout';
import { CONTENT_PADDING, ContentBox, getNormalizedPositions } from '../components/ArchDiaSvgRenderer';

/**
 * A freshly computed layout with the relation bends of the old one kept.
 *
 * No layout engine has an opinion on where a relation's centre should be — they place elements
 * and leave the curves between them to follow. So rearranging a diagram, by whatever means, does
 * not undo the bends given by hand: they are offsets, and they travel with the elements they hang
 * between. Straightening one relation, or all of them, is asked for at the relation itself.
 */
function keepingBends(layout: ArchDiaLayout, previous: ArchDiaLayout): ArchDiaLayout {
    return previous.bends ? { ...layout, bends: previous.bends } : layout;
}

/**
 * Reset layout by re-parsing from source-only text, triggering ELK auto-layout.
 * Async because parseArchDiaFile calls computeElkLayout internally.
 */
export async function resetLayout(
    archDiaFile: ArchDiaFile,
    scene: DiagramScene,
): Promise<ArchDiaFile> {
    const sourceOnly = archDiaFile.sources
        .map(s => {
            const lines = ['---'];
            if (s.id) lines.push(`id: ${s.id}`);
            lines.push('type: PLANTUML');
            if (s.name) lines.push(`name: ${s.name}`);
            lines.push('---');
            return lines.join('\n') + '\n' + s.source;
        })
        .join('\n===\n');
    const reset = await parseArchDiaFile(sourceOnly, scene, archDiaFile.layout.size);
    return { ...reset, layout: keepingBends(reset.layout, archDiaFile.layout) };
}

/**
 * Replace the layout with the one PlantUML would have drawn.
 *
 * The layout an imported diagram arrives with, and the way back to it once the
 * diagram has been rearranged by hand. It sets the document bounds as well as
 * the positions, so the diagram comes back whole into the visible area.
 */
export async function applyPlantUmlLayout(
    archDiaFile: ArchDiaFile,
    scene: DiagramScene,
): Promise<ArchDiaFile> {
    const layout = await computePlantUmlLayout(scene, getCombinedSource(archDiaFile), archDiaFile.layout.size);
    return { ...archDiaFile, layout: keepingBends(layout, archDiaFile.layout) };
}

/**
 * Replace layout with a treemap-based layout.
 */
export function applyTreemapLayout(
    archDiaFile: ArchDiaFile,
    scene: DiagramScene,
): ArchDiaFile {
    const newLayout = computeTreemapLayout(scene, archDiaFile.layout.size);
    return { ...archDiaFile, layout: keepingBends(newLayout, archDiaFile.layout) };
}

/**
 * Crop the layout around its content, the content moving with the crop.
 *
 * The new size is the one the content needs; on its own it would be taken off the right and the
 * bottom, and a diagram drawn away from the origin would end up hanging outside its own page. So
 * the content is carried back to sit `CONTENT_PADDING` from the top left of the new size, which,
 * that size being the content plus the same margin on each side, leaves it centred in it.
 *
 * `contentBox` comes from ArchDiaSvgRenderer's onSizeChange callback: it is measured on what is
 * drawn, display options included, which no re-reading of the model here could tell.
 */
export function fitToContent(
    archDiaFile: ArchDiaFile,
    contentBox: ContentBox,
): ArchDiaFile {
    const { x, y, width, height } = contentBox;
    const shiftX = CONTENT_PADDING - x;
    const shiftY = CONTENT_PADDING - y;

    const positions = { ...archDiaFile.layout.positions };
    if (shiftX !== 0 || shiftY !== 0) {
        for (const [id, pos] of Object.entries(positions)) {
            if (!pos) continue;
            positions[id] = { ...pos, x: Math.round(pos.x + shiftX), y: Math.round(pos.y + shiftY) };
        }
    }

    return {
        ...archDiaFile,
        layout: { ...archDiaFile.layout, size: { width, height }, positions },
    };
}

/**
 * Normalize positions so no x/y is negative, centering content within the layout bounds.
 * Returns the same reference if no changes were needed.
 */
export function normalizePositions(
    archDiaFile: ArchDiaFile,
    scene: DiagramScene,
): ArchDiaFile {
    const updates = getNormalizedPositions(
        archDiaFile.layout.positions,
        scene.components,
        scene.containers,
        archDiaFile.layout.size,
    );
    if (!updates) return archDiaFile;
    const newPositions = { ...archDiaFile.layout.positions };
    for (const [id, pos] of Object.entries(updates)) {
        newPositions[id] = { ...newPositions[id], ...pos };
    }
    return {
        ...archDiaFile,
        layout: { ...archDiaFile.layout, positions: newPositions },
    };
}
