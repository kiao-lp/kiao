import { Criticality } from './matchers';
import { GateFinding } from './scan';

/** Highlights rendered text via the Custom Highlight API. Matches by text, not offsets. */

const highlightName = (level: Criticality): string => `gate-${level}`;

const CURRENT_HIGHLIGHT = 'gate-current';

const ALL_NAMES = ['critical', 'high', 'medium', 'low']
    .map(level => highlightName(level as Criticality))
    .concat(CURRENT_HIGHLIGHT);

/** Null without the Highlight API. */
const registry = (): HighlightRegistry | null =>
    typeof CSS !== 'undefined' && typeof Highlight !== 'undefined' && CSS.highlights ? CSS.highlights : null;

/** Clears all gate highlights. Call before repaint and on unmount. */
export const clearFindings = (): void => {
    const highlights = registry();
    if (highlights) for (const name of ALL_NAMES) highlights.delete(name);
};

interface TextRun {
    node: Text;
    start: number;
}

const flatten = (container: HTMLElement): { runs: TextRun[]; text: string } => {
    const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const runs: TextRun[] = [];
    let text = '';
    let node = walker.nextNode() as Text | null;
    while (node) {
        runs.push({ node, start: text.length });
        text += node.data;
        node = walker.nextNode() as Text | null;
    }
    return { runs, text };
};

const rangeOver = (doc: Document, runs: TextRun[], start: number, end: number): Range | null => {
    const from = runs.find(run => start < run.start + run.node.data.length && start >= run.start);
    const to = runs.find(run => end <= run.start + run.node.data.length && end > run.start);
    if (!from || !to) return null;
    const range = doc.createRange();
    range.setStart(from.node, start - from.start);
    range.setEnd(to.node, end - to.start);
    return range;
};

/** Returns the current finding's range, or null. */
export const paintFindings = (
    container: HTMLElement,
    findings: GateFinding[],
    currentIndex: number,
): Range | null => {
    const highlights = registry();
    if (!highlights) return null;
    clearFindings();

    const { runs, text } = flatten(container);
    const doc = container.ownerDocument;
    const byLevel = new Map<Criticality, Range[]>();
    let currentRange: Range | null = null;
    // Reading order keeps repeats aligned.
    let cursor = 0;

    findings.forEach((finding, index) => {
        const at = text.indexOf(finding.text, cursor);
        if (at < 0) return; // Rendering changed it; navigator still lists it.
        cursor = at + finding.text.length;
        const range = rangeOver(doc, runs, at, cursor);
        if (!range) return;
        const level = finding.matcher.criticality;
        byLevel.set(level, [...(byLevel.get(level) ?? []), range]);
        if (index === currentIndex) currentRange = range;
    });

    for (const [level, ranges] of byLevel) {
        highlights.set(highlightName(level), new Highlight(...ranges));
    }
    if (currentRange) highlights.set(CURRENT_HIGHLIGHT, new Highlight(currentRange));
    return currentRange;
};
