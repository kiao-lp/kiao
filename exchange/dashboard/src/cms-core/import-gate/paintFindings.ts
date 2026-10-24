import { Criticality } from './matchers';
import { GateFinding } from './scan';

/**
 * Painting the gate's findings over a document the gate did not lay out.
 *
 * When the preview is a `<pre>` this module is not needed: the segments are known, and each one is
 * its own `<mark>`. Markdown is the other case — it is *rendered*, the DOM belongs to React, and
 * inserting an element into it would be a node React never made, torn out again on its next pass
 * and splitting the text nodes anything else reads. So the findings go to the browser as
 * **ranges**, through the CSS Custom Highlight API, styled from `cms-core.css` under
 * `::highlight(gate-<level>)`. Nothing is inserted; a decoration is drawn over a document left
 * alone. It is the same reasoning, and the same mechanism, as the passage a `#text=` link names.
 *
 * **The findings are located by their text, not by their offsets.** The scan reads the Markdown
 * *source* — that is where a redaction has to cut, and where the offsets mean something — while
 * this paints the *rendered* output, in which the markers are gone, a table is a grid and a link is
 * its label. There is no offset mapping between the two that is worth writing. What survives
 * rendering is the matched string itself, so each finding is looked for in reading order from where
 * the last one ended, which keeps repeats in step.
 *
 * The search runs over the container's text nodes *flattened*, so a passage the rendering split
 * across elements — `10.0.<em>0.4</em>` — is still found and still one range. What cannot be found
 * is a passage the rendering **changed**: a finding that swallowed the `**` around a word, or a
 * link whose target never appears in the output. Those keep their place in the navigator and in the
 * source a redaction cuts into; they simply carry no colour.
 */

/** The name a level is registered under; the stylesheet paints `::highlight(gate-critical)`. */
const highlightName = (level: Criticality): string => `gate-${level}`;

/** The one the navigator is standing on, drawn over its level. */
const CURRENT_HIGHLIGHT = 'gate-current';

const ALL_NAMES = ['critical', 'high', 'medium', 'low']
    .map(level => highlightName(level as Criticality))
    .concat(CURRENT_HIGHLIGHT);

/** False in a browser with no Highlight API, where a rendered preview simply carries no colour. */
const registry = (): HighlightRegistry | null =>
    typeof CSS !== 'undefined' && typeof Highlight !== 'undefined' && CSS.highlights ? CSS.highlights : null;

/** Takes every gate highlight off the page. Called before repainting, and when the pane goes. */
export const clearFindings = (): void => {
    const highlights = registry();
    if (highlights) for (const name of ALL_NAMES) highlights.delete(name);
};

/** One text node and where it starts in the container's flattened text. */
interface TextRun {
    node: Text;
    start: number;
}

/** The container's text nodes in reading order, with the string they spell out between them. */
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

/** Turns a span of the flattened text back into a Range across whatever nodes it crosses. */
const rangeOver = (doc: Document, runs: TextRun[], start: number, end: number): Range | null => {
    const from = runs.find(run => start < run.start + run.node.data.length && start >= run.start);
    const to = runs.find(run => end <= run.start + run.node.data.length && end > run.start);
    if (!from || !to) return null;
    const range = doc.createRange();
    range.setStart(from.node, start - from.start);
    range.setEnd(to.node, end - to.start);
    return range;
};

/**
 * Paints the findings over a rendered container, and answers with the range of the current one so
 * the caller can scroll to it. `currentIndex` is an index into `findings`, or -1 for none.
 */
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
    // Reading order, so the second `10.0.0.1` in the document is the second one in the list.
    let cursor = 0;

    findings.forEach((finding, index) => {
        const at = text.indexOf(finding.text, cursor);
        if (at < 0) return; // the rendering changed it; the navigator still has it
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
