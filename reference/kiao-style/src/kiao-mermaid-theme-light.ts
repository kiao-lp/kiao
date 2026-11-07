/**
 * Mermaid light theme — matches the archdia / kiao-light visual style.
 *
 * Usage:
 *   import { kiaoMermaidLight } from 'kiao-style';
 *   mermaid.initialize({ theme: 'base', themeVariables: kiaoMermaidLight });
 */

import { KIAO_DIAGRAM_GEOMETRY, kiaoDiagramPalette } from './kiao-diagram.js';

const p = kiaoDiagramPalette('light');
const g = KIAO_DIAGRAM_GEOMETRY;

export const kiaoMermaidLight = {
    darkMode: false,

    // ── Background ──────────────────────────────────────────────
    background: p.pageBg,

    // ── Primary nodes (components) ──────────────────────────────
    primaryColor: p.boxFill,
    primaryBorderColor: p.boxBorder,
    primaryTextColor: p.boxText,

    // ── Secondary nodes ─────────────────────────────────────────
    secondaryColor: '#dfe1e8',
    secondaryBorderColor: p.boxBorder,
    secondaryTextColor: p.boxText,

    // ── Tertiary nodes ──────────────────────────────────────────
    tertiaryColor: '#f3f4f6',
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
    activationBkgColor: '#dfe1e8',
    activationBorderColor: p.boxBorder,
    labelBoxBkgColor: p.boxFill,
    labelBoxBorderColor: p.boxBorder,
    labelTextColor: p.boxText,
    loopTextColor: p.edge,

    // ── State diagram ───────────────────────────────────────────
    labelColor: p.boxText,
    altBackground: '#f3f4f6',

    // ── Pie chart ───────────────────────────────────────────────
    pie1: '#2563eb',
    pie2: '#d97706',
    pie3: '#16a34a',
    pie4: '#dc2626',
    pie5: '#7c3aed',
    pie6: '#db2777',
    pie7: '#0891b2',
    pie8: '#65a30d',
    pieTitleTextColor: p.boxText,
    pieSectionTextColor: '#ffffff',
    pieLegendTextColor: p.edge,
    pieSectionTextSize: '14px',
    pieStrokeColor: '#c8ccd4',
    pieStrokeWidth: '1.5px',

    // ── Class diagram ───────────────────────────────────────────
    classText: p.boxText,

    // ── Git graph ───────────────────────────────────────────────
    git0: '#2563eb',
    git1: '#d97706',
    git2: '#16a34a',
    git3: '#dc2626',
    git4: '#7c3aed',
    git5: '#db2777',
    git6: '#0891b2',
    git7: '#65a30d',
    gitBranchLabel0: '#ffffff',
    gitBranchLabel1: '#ffffff',
    gitBranchLabel2: '#ffffff',
    gitBranchLabel3: '#ffffff',
    gitInv0: p.pageBg,

    // ── ER diagram ──────────────────────────────────────────────
    entityBkg: p.boxFill,
    entityBorderColor: p.boxBorder,
    entityTextColor: p.boxText,
    relationColor: p.edge,
    relationLabelColor: p.edge,
    relationLabelBackground: p.pageBg,

    // ── Gantt chart ─────────────────────────────────────────────
    sectionBkgColor: '#f3f4f6',
    altSectionBkgColor: '#e8eaf0',
    gridColor: '#c8ccd4',
    todayLineColor: '#2563eb',
    taskBkgColor: '#2563eb',
    taskTextColor: '#ffffff',
    activeTaskBkgColor: '#1d4ed8',
    activeTaskBorderColor: '#2563eb',
    doneTaskBkgColor: '#bfdbfe',
    doneTaskBorderColor: p.boxBorder,
    taskBorderColor: p.boxBorder,
    taskTextDarkColor: p.boxText,
    taskTextLightColor: '#ffffff',

    // ── Requirement diagram ─────────────────────────────────────
    requirementBackground: p.boxFill,
    requirementBorderColor: p.boxBorder,
    requirementTextColor: p.boxText,
    relationLabelFontSize: `${g.edgeLabelFontSize}px`,
} as const;
