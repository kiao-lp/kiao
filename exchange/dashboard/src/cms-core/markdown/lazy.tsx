import { lazyComponent } from '../core/lazyComponent';

export const Mermaid = lazyComponent(() => import('./components/Mermaid').then(m => ({ default: m.Mermaid })));
export const PlantUML = lazyComponent(() => import('./components/PlantUML').then(m => ({ default: m.PlantUML })));
export const ArchDia = lazyComponent(() => import('./components/ArchDia').then(m => ({ default: m.ArchDia })));
export const Graph = lazyComponent(() => import('./components/Graph').then(m => ({ default: m.Graph })));
export const SvgRenderer = lazyComponent(() => import('./components/SvgRenderer').then(m => ({ default: m.SvgRenderer })));

export const printMarkdownToPdf: typeof import('./printMarkdownToPdf').printMarkdownToPdf = async (...args) =>
    (await import('./printMarkdownToPdf')).printMarkdownToPdf(...args);

export const exportMarkdownToDocx: typeof import('./exportMarkdownToDocx').exportMarkdownToDocx = async (...args) =>
    (await import('./exportMarkdownToDocx')).exportMarkdownToDocx(...args);

export const generateStaticMarkdown: typeof import('./static/generateStaticMarkdown').generateStaticMarkdown = async (...args) =>
    (await import('./static/generateStaticMarkdown')).generateStaticMarkdown(...args);

export const generateKiaoDiagramMarkdown: typeof import('./static/generateKiaoDiagramMarkdown').generateKiaoDiagramMarkdown = async (...args) =>
    (await import('./static/generateKiaoDiagramMarkdown')).generateKiaoDiagramMarkdown(...args);
