/**
 * Mermaid sober light theme — matches the kiao-sober-light visual style.
 *
 * Usage:
 *   import { kiaoMermaidSoberLight } from 'kiao-style';
 *   mermaid.initialize({ theme: 'base', themeVariables: kiaoMermaidSoberLight });
 */

import { KIAO_DIAGRAM_GEOMETRY, kiaoDiagramPalette } from './kiao-diagram.js';

const p = kiaoDiagramPalette('sober-light');
const g = KIAO_DIAGRAM_GEOMETRY;

export const kiaoMermaidSoberLight = {
    darkMode: false,

    // ── Background ──────────────────────────────────────────────
    background: p.pageBg,

    // ── Primary nodes (components) ──────────────────────────────
    primaryColor: p.boxFill,
    primaryBorderColor: p.boxBorder,
    primaryTextColor: p.boxText,

    // ── Secondary nodes ─────────────────────────────────────────
    secondaryColor: '#F1F5F9',
    secondaryBorderColor: p.boxBorder,
    secondaryTextColor: p.boxText,

    // ── Tertiary nodes ──────────────────────────────────────────
    tertiaryColor: '#E2E8F0',
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
    activationBkgColor: '#E2E8F0',
    activationBorderColor: p.boxBorder,
    labelBoxBkgColor: p.boxFill,
    labelBoxBorderColor: p.boxBorder,
    labelTextColor: p.boxText,
    loopTextColor: p.edge,

    // ── State diagram ───────────────────────────────────────────
    labelColor: p.boxText,
    altBackground: '#F1F5F9',

    // ── Pie chart ───────────────────────────────────────────────
    pie1: '#2563EB',
    pie2: '#059669',
    pie3: '#D97706',
    pie4: '#DC2626',
    pie5: '#7C3AED',
    pie6: '#0891B2',
    pie7: '#DB2777',
    pie8: '#65A30D',
    pieTitleTextColor: p.boxText,
    pieSectionTextColor: '#FFFFFF',
    pieLegendTextColor: p.edge,
    pieSectionTextSize: '14px',
    pieStrokeColor: '#CBD5E1',
    pieStrokeWidth: '1.5px',

    // ── Class diagram ───────────────────────────────────────────
    classText: p.boxText,

    // ── Git graph ───────────────────────────────────────────────
    git0: '#2563EB',
    git1: '#059669',
    git2: '#D97706',
    git3: '#DC2626',
    git4: '#7C3AED',
    git5: '#0891B2',
    git6: '#DB2777',
    git7: '#65A30D',
    gitBranchLabel0: '#FFFFFF',
    gitBranchLabel1: '#FFFFFF',
    gitBranchLabel2: '#FFFFFF',
    gitBranchLabel3: '#FFFFFF',
    gitInv0: p.pageBg,

    // ── ER diagram ──────────────────────────────────────────────
    entityBkg: p.boxFill,
    entityBorderColor: p.boxBorder,
    entityTextColor: p.boxText,
    relationColor: p.edge,
    relationLabelColor: p.edge,
    relationLabelBackground: p.pageBg,

    // ── Gantt chart ─────────────────────────────────────────────
    sectionBkgColor: '#F1F5F9',
    altSectionBkgColor: '#FFFFFF',
    gridColor: '#CBD5E1',
    todayLineColor: '#DC2626',
    taskBkgColor: '#93C5FD',
    taskTextColor: p.boxText,
    activeTaskBkgColor: '#1D4ED8',
    activeTaskBorderColor: '#1D4ED8',
    doneTaskBkgColor: '#E2E8F0',
    doneTaskBorderColor: p.boxBorder,
    taskBorderColor: p.boxBorder,
    taskTextDarkColor: p.boxText,
    taskTextLightColor: '#FFFFFF',

    // ── Requirement diagram ─────────────────────────────────────
    requirementBackground: p.boxFill,
    requirementBorderColor: p.boxBorder,
    requirementTextColor: p.boxText,
    relationLabelFontSize: `${g.edgeLabelFontSize}px`,
} as const;
