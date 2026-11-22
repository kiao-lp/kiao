/**
 * Taking a diagram written in another language into the archdia format.
 *
 * A `plantuml` block is already the language archdia reads, so it only needs the
 * block header and a layout; a `mermaid` block has to be translated first. Both
 * come out as the text of an `.arch.md` file — frontmatter sections separated by
 * `===` — ready to be parsed, edited, and written back over the original block.
 */

import { DiagramScene } from './archdia-model';
import { serializeArchDiaFile } from './archdia-parser';
import { plantumlExtractor } from './diagram-source';
import { mermaidToPlantUml } from './mermaid-source';
import { computePlantUmlLayout, PlantUmlLayoutOptions } from './plantuml-layout';

/** Fenced-block languages that can be brought into the archdia editor. */
export const IMPORTABLE_LANGUAGES = ['archdia', 'plantuml', 'mermaid'] as const;

export type ImportableLanguage = (typeof IMPORTABLE_LANGUAGES)[number];

export const isImportableLanguage = (language: string): language is ImportableLanguage =>
    (IMPORTABLE_LANGUAGES as readonly string[]).includes(language);

/**
 * The PlantUML behind a diagram written in `language`.
 *
 * @throws {Error} when the language is not one archdia can read, or when a
 *   mermaid diagram is of a kind that has no archdia equivalent.
 */
export const toPlantUmlSource = (language: string, code: string): string => {
    switch (language) {
        case 'plantuml': return code;
        case 'mermaid': return mermaidToPlantUml(code);
        default: throw new Error(`\`${language}\` diagrams cannot be edited as archdia.`);
    }
};

/**
 * Convert a `plantuml` or `mermaid` diagram into the text of an archdia block,
 * under the PlantUML layout — the diagram opens where PlantUML would have
 * drawn it, whole and inside the visible area, rather than as a pile of boxes
 * at the origin or as an arrangement the reader has to find their way around
 * again.
 */
export const importAsArchDia = async (
    language: string,
    code: string,
    options?: PlantUmlLayoutOptions,
): Promise<string> => {
    const source = toPlantUmlSource(language, code);
    const scene: DiagramScene = {
        components: plantumlExtractor.extractComponents(source),
        containers: plantumlExtractor.extractContainers(source),
        relations: plantumlExtractor.extractRelations(source),
    };

    return serializeArchDiaFile({ sources: [{ source }], layout: await computePlantUmlLayout(scene, source, options) });
};
