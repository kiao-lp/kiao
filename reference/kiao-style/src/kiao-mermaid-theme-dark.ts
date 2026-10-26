/**
 * Mermaid dark theme — matches the archdia / kiao-dark visual style.
 *
 * Usage:
 *   import { kiaoMermaidDark } from 'kiao-style';
 *   mermaid.initialize({ theme: 'base', themeVariables: kiaoMermaidDark });
 */

import { KIAO_DIAGRAM_GEOMETRY, kiaoDiagramPalette } from './kiao-diagram.js';

const p = kiaoDiagramPalette('dark');
const g = KIAO_DIAGRAM_GEOMETRY;

export const kiaoMermaidDark = {
    darkMode: true,

    // ── Background ──────────────────────────────────────────────
    background: p.pageBg,

    // ── Primary nodes (components) ──────────────────────────────
    primaryColor: p.boxFill,
    primaryBorderColor: p.boxBorder,
    primaryTextColor: p.boxText,

    // ── Secondary nodes ─────────────────────────────────────────
    secondaryColor: '#1a2236',
    secondaryBorderColor: p.boxBorder,
    secondaryTextColor: p.boxText,

    // ── Tertiary nodes ──────────────────────────────────────────
    tertiaryColor: '#0e1320',
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
    activationBkgColor: '#1a2236',
    activationBorderColor: p.boxBorder,
    labelBoxBkgColor: p.boxFill,
    labelBoxBorderColor: p.boxBorder,
    labelTextColor: p.boxText,
    loopTextColor: p.edge,

    // ── State diagram ───────────────────────────────────────────
    labelColor: p.boxText,
    altBackground: '#0e1320',

    // ── Pie chart ───────────────────────────────────────────────
    pie1: '#60a5fa',
    pie2: '#f59e0b',
    pie3: '#10b981',
    pie4: '#ef4444',
    pie5: '#8b5cf6',
    pie6: '#ec4899',
    pie7: '#06b6d4',
    pie8: '#84cc16',
    pieTitleTextColor: p.boxText,
    pieSectionTextColor: p.boxText,
    pieLegendTextColor: p.edge,
    pieSectionTextSize: '14px',
    pieStrokeColor: '#263040',
    pieStrokeWidth: '1.5px',

    // ── Class diagram ───────────────────────────────────────────
    classText: p.boxText,

    // ── Git graph ───────────────────────────────────────────────
    git0: '#60a5fa',
    git1: '#f59e0b',
    git2: '#10b981',
    git3: '#ef4444',
    git4: '#8b5cf6',
    git5: '#ec4899',
    git6: '#06b6d4',
    git7: '#84cc16',
    gitBranchLabel0: p.boxText,
    gitBranchLabel1: p.boxText,
    gitBranchLabel2: p.boxText,
    gitBranchLabel3: p.boxText,
    gitInv0: p.pageBg,

    // ── ER diagram ──────────────────────────────────────────────
    entityBkg: p.boxFill,
    entityBorderColor: p.boxBorder,
    entityTextColor: p.boxText,
    relationColor: p.edge,
    relationLabelColor: p.edge,
    relationLabelBackground: p.pageBg,

    // ── Gantt chart ─────────────────────────────────────────────
    sectionBkgColor: '#0e1320',
    altSectionBkgColor: '#1a2236',
    gridColor: '#263040',
    todayLineColor: '#60a5fa',
    taskBkgColor: '#60a5fa',
    taskTextColor: p.boxText,
    activeTaskBkgColor: '#3b82f6',
    activeTaskBorderColor: '#60a5fa',
    doneTaskBkgColor: '#1e3a5f',
    doneTaskBorderColor: p.boxBorder,
    taskBorderColor: p.boxBorder,
    taskTextDarkColor: p.boxText,
    taskTextLightColor: p.boxText,

    // ── Requirement diagram ─────────────────────────────────────
    requirementBackground: p.boxFill,
    requirementBorderColor: p.boxBorder,
    requirementTextColor: p.boxText,
    relationLabelFontSize: `${g.edgeLabelFontSize}px`,
} as const;
