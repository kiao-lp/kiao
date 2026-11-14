/**
 * PlantUML themes — one skinparam block per application theme, all drawn from
 * the unified diagram palette.
 *
 * Usage:
 *   import { kiaoPlantUMLDark, injectPlantUMLTheme } from 'kiao-style';
 *   const themed = injectPlantUMLTheme(source, kiaoPlantUMLDark);
 */

import { KIAO_DIAGRAM_GEOMETRY, kiaoDiagramPalette, kiaoDiagramPdfPalette, type KiaoDiagramPalette } from './kiao-diagram.js';

const g = KIAO_DIAGRAM_GEOMETRY;

export function buildPlantUMLSkinparams(p: KiaoDiagramPalette): string {
    return `
skinparam backgroundColor ${p.pageBg}
skinparam defaultFontName Inter
skinparam defaultFontColor ${p.boxText}
skinparam defaultFontSize ${g.boxFontSize}

skinparam ArrowColor ${p.edge}
skinparam ArrowFontColor ${p.edge}
skinparam ArrowFontName Inter
skinparam ArrowFontSize ${g.edgeLabelFontSize}

skinparam RoundCorner ${g.plantUmlRoundCorner}

skinparam component {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam participant {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam actor {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam boundary {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam control {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam usecase {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam class {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    AttributeFontColor ${p.edge}
    StereotypeFontColor ${p.edge}
    HeaderBackgroundColor ${p.headerBg}
}

skinparam object {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam interface {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam entity {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam database {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam queue {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam collections {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam artifact {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam rectangle {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StereotypeFontColor ${p.edge}
}

skinparam package {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
    StereotypeFontColor ${p.edge}
}

skinparam folder {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}

skinparam cloud {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}

skinparam node {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}

skinparam frame {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}

skinparam note {
    BackgroundColor ${p.noteBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}

skinparam legend {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
}

skinparam activity {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    DiamondBackgroundColor ${p.boxFill}
    DiamondBorderColor ${p.boxBorder}
    DiamondFontColor ${p.boxText}
    StartColor ${p.accent}
    EndColor ${p.accent}
    BarColor ${p.edge}
}

skinparam state {
    BackgroundColor ${p.boxFill}
    BorderColor ${p.boxBorder}
    FontColor ${p.boxText}
    StartColor ${p.accent}
    EndColor ${p.accent}
}

skinparam sequence {
    LifeLineBorderColor ${p.edge}
    LifeLineBackgroundColor ${p.noteBg}
    GroupBackgroundColor ${p.groupBg}
    GroupBodyBackgroundColor ${p.groupBg}
    GroupBorderColor ${p.boxBorder}
    GroupFontColor ${p.edge}
    GroupHeaderFontColor ${p.boxText}
    DividerBackgroundColor ${p.boxFill}
    DividerBorderColor ${p.boxBorder}
    DividerFontColor ${p.edge}
    ReferenceBackgroundColor ${p.boxFill}
    ReferenceHeaderBackgroundColor ${p.groupBg}
    ReferenceBorderColor ${p.boxBorder}
    ReferenceFontColor ${p.boxText}
    BoxBackgroundColor ${p.groupBg}
    BoxBorderColor ${p.boxBorder}
}

skinparam partition {
    BackgroundColor ${p.groupBg}
    BorderColor ${p.boxBorder}
    FontColor ${p.edge}
}
`.trim();
}

export const kiaoPlantUMLDark = buildPlantUMLSkinparams(kiaoDiagramPalette('dark'));
export const kiaoPlantUMLLight = buildPlantUMLSkinparams(kiaoDiagramPalette('light'));
export const kiaoPlantUMLSoberDark = buildPlantUMLSkinparams(kiaoDiagramPalette('sober-dark'));
export const kiaoPlantUMLSoberLight = buildPlantUMLSkinparams(kiaoDiagramPalette('sober-light'));

/** The skinparams a diagram is re-rendered with for the PDF export: light on white. */
export const kiaoPlantUMLPdf = buildPlantUMLSkinparams(kiaoDiagramPdfPalette());
