/**
 * Mermaid sober dark theme — matches the kiao-sober-dark visual style.
 *
 * Usage:
 *   import { kiaoMermaidSoberDark } from 'kiao-style';
 *   mermaid.initialize({ theme: 'base', themeVariables: kiaoMermaidSoberDark });
 */

import { KIAO_DIAGRAM_GEOMETRY, kiaoDiagramPalette } from './kiao-diagram.js';

const p = kiaoDiagramPalette('sober-dark');
const g = KIAO_DIAGRAM_GEOMETRY;

export const kiaoMermaidSoberDark = {
    darkMode: true,

    // ── Background ──────────────────────────────────────────────
    background: p.pageBg,

    // ── Primary nodes (components) ──────────────────────────────
    primaryColor: p.boxFill,
    primaryBorderColor: p.boxBorder,
    primaryTextColor: p.boxText,

    // ── Secondary nodes ─────────────────────────────────────────
    secondaryColor: '#1C2128',
    secondaryBorderColor: p.boxBorder,
    secondaryTextColor: p.boxText,

    // ── Tertiary nodes ──────────────────────────────────────────
    tertiaryColor: '#21262D',
    tertiaryBorderColor: p.boxBorder,
    tertiaryTextColor: p.boxText,

    // ── Notes ───────────────────────────────────────────────────
    noteBkgColor: p.noteBg,
    noteTextColor: p.edge,
    noteBorderColor: p.boxBorder,

    // ── Edges & labels ──────────────────────────────────────────
    lineColor: p.edge,
    textColor: p.boxText,
    edgeLabelBackground: p.pageBg,

    // ── Clusters (subgraphs → archdia containers) ───────────────
    clusterBkg: p.groupBg,
    clusterBorder: p.boxBorder,

    // ── Fonts ───────────────────────────────────────────────────
    fontFamily: g.boxFontFamily,
    fontSize: `${g.boxFontSize}px`,

    // ── Flowchart specifics ─────────────────────────────────────
    mainBkg: p.boxFill,
    nodeBorder: p.boxBorder,
    nodeTextColor: p.boxText,
    titleColor: p.boxText,

    // ── Sequence diagram ────────────────────────────────────────
    actorBkg: p.boxFill,
    actorBorder: p.boxBorder,
    actorTextColor: p.boxText,
    actorLineColor: p.edge,
    signalColor: p.edge,
    signalTextColor: p.boxText,
    activationBkgColor: '#21262D',
    activationBorderColor: p.boxBorder,
    labelBoxBkgColor: p.boxFill,
    labelBoxBorderColor: p.boxBorder,
    labelTextColor: p.boxText,
    loopTextColor: p.edge,

    // ── State diagram ───────────────────────────────────────────
    labelColor: p.boxText,
    altBackground: '#12171F',

    // ── Pie chart ───────────────────────────────────────────────
    pie1: '#58A6FF',
    pie2: '#3FB950',
    pie3: '#D29922',
    pie4: '#F85149',
    pie5: '#A371F7',
    pie6: '#39C5CF',
    pie7: '#DB61A2',
    pie8: '#8DDB8C',
    pieTitleTextColor: p.boxText,
    pieSectionTextColor: '#0D1117',
    pieLegendTextColor: p.edge,
    pieSectionTextSize: '14px',
    pieStrokeColor: '#3D444D',
    pieStrokeWidth: '1.5px',

    // ── Class diagram ───────────────────────────────────────────
    classText: p.boxText,

    // ── Git graph ───────────────────────────────────────────────
    git0: '#58A6FF',
    git1: '#3FB950',
    git2: '#D29922',
    git3: '#F85149',
    git4: '#A371F7',
    git5: '#39C5CF',
    git6: '#DB61A2',
    git7: '#8DDB8C',
    gitBranchLabel0: '#0D1117',
    gitBranchLabel1: '#0D1117',
    gitBranchLabel2: '#0D1117',
    gitBranchLabel3: '#0D1117',
    gitInv0: p.pageBg,

    // ── ER diagram ──────────────────────────────────────────────
    entityBkg: p.boxFill,
    entityBorderColor: p.boxBorder,
    entityTextColor: p.boxText,
    relationColor: p.edge,
    relationLabelColor: p.edge,
    relationLabelBackground: p.pageBg,

    // ── Gantt chart ─────────────────────────────────────────────
    sectionBkgColor: '#12171F',
    altSectionBkgColor: p.boxFill,
    gridColor: '#3D444D',
    todayLineColor: '#F85149',
    taskBkgColor: '#1F4C82',
    taskTextColor: p.boxText,
    activeTaskBkgColor: '#58A6FF',
    activeTaskBorderColor: '#58A6FF',
    doneTaskBkgColor: '#21262D',
    doneTaskBorderColor: p.boxBorder,
    taskBorderColor: p.boxBorder,
    taskTextDarkColor: '#0D1117',
    taskTextLightColor: p.boxText,

    // ── Requirement diagram ─────────────────────────────────────
    requirementBackground: p.boxFill,
    requirementBorderColor: p.boxBorder,
    requirementTextColor: p.boxText,
    relationLabelFontSize: `${g.edgeLabelFontSize}px`,
} as const;
