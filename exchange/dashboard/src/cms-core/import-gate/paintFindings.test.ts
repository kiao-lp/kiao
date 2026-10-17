import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Criticality, GateMatcher, parseCategory } from './matchers';
import { scanText } from './scan';
import { clearFindings, paintFindings } from './paintFindings';

/**
 * The findings, mapped onto a document the gate did not lay out.
 *
 * jsdom has `Range` and `TreeWalker` and no Highlight API, so the registry is stood up here: what
 * the browser would paint is exactly what these ranges say, and the ranges are the part worth
 * pinning. The mapping is by *text* rather than by offset — the scan reads Markdown source and this
 * paints the rendered output — so what it has to get right is which occurrence goes where.
 */

class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) { this.ranges = ranges; }
}

let registry: Map<string, FakeHighlight>;

beforeEach(() => {
    registry = new Map();
    (globalThis as Record<string, unknown>).Highlight = FakeHighlight;
    (globalThis as Record<string, unknown>).CSS = { highlights: registry };
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).Highlight;
    delete (globalThis as Record<string, unknown>).CSS;
    document.body.innerHTML = '';
});

const rule = (label: string, pattern: string, criticality: Criticality = 'high'): GateMatcher =>
    parseCategory(`${label}.json`, {
        category: label, label, criticality, matchers: [{ label, pattern }],
    })[0];

const gate = [
    rule('aws', '\\bAKIA[0-9A-Z]{16}\\b', 'critical'),
    rule('ip', '\\b10(?:\\.\\d{1,3}){3}\\b', 'high'),
];

/** Renders some HTML and returns the container, as a Markdown renderer would have left it. */
const rendered = (html: string): HTMLElement => {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
};

/** What each level's highlight covers, as strings. */
const painted = (name: string): string[] =>
    (registry.get(name)?.ranges ?? []).map(range => range.toString());

describe('paintFindings', () => {
    it('paints each finding at its level, wherever the rendering put it', () => {
        const source = 'The key AKIA1234567890123456 reaches 10.0.0.4 daily.';
        const container = rendered('<p>The key <code>AKIA1234567890123456</code> reaches 10.0.0.4 daily.</p>');

        paintFindings(container, scanText(source, gate).findings, -1);

        expect(painted('gate-critical')).toEqual(['AKIA1234567890123456']);
        expect(painted('gate-high')).toEqual(['10.0.0.4']);
    });

    // The rendering splits the sentence across elements and the finding is still one range: the
    // walk is over text nodes, not over elements.
    it('spans a finding broken across two elements by the rendering', () => {
        const source = 'host 10.0.0.4 here';
        const container = rendered('<p>host 10.0.<em>0.4</em> here</p>');

        paintFindings(container, scanText(source, gate).findings, -1);

        expect(painted('gate-high')).toEqual(['10.0.0.4']);
    });

    it('keeps repeats in step, one range per occurrence', () => {
        const source = 'from 10.0.0.1 to 10.0.0.2 via 10.0.0.1';
        const container = rendered('<p>from 10.0.0.1 to 10.0.0.2 via 10.0.0.1</p>');

        paintFindings(container, scanText(source, gate).findings, -1);

        expect(painted('gate-high')).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.1']);
    });

    it('marks the one the navigator is on, and answers with its range', () => {
        const source = 'from 10.0.0.1 to 10.0.0.2';
        const container = rendered('<p>from 10.0.0.1 to 10.0.0.2</p>');
        const findings = scanText(source, gate).findings;

        const range = paintFindings(container, findings, 1);

        expect(range?.toString()).toBe('10.0.0.2');
        expect(painted('gate-current')).toEqual(['10.0.0.2']);
    });

    // What the rendering *removed* is another matter: a finding that swallowed the `**` around a
    // word has no counterpart in the output, since the markers are not there any more. It stays in
    // the navigator and in the source — where a redaction would cut it — and is simply not coloured.
    it('skips a finding the rendering did not keep verbatim, and paints the rest', () => {
        const secret = rule('secret', 'password: \\S+', 'critical');
        const source = 'password: **hunter2** and host 10.0.0.4';
        const container = rendered('<p>password: <strong>hunter2</strong> and host 10.0.0.4</p>');

        paintFindings(container, scanText(source, [secret, ...gate]).findings, -1);

        expect(painted('gate-critical')).toEqual([]); // the asterisks are gone from the rendering
        expect(painted('gate-high')).toEqual(['10.0.0.4']);
    });

    it('repaints from scratch rather than adding to what was there', () => {
        const source = 'host 10.0.0.4';
        const container = rendered('<p>host 10.0.0.4</p>');
        const findings = scanText(source, gate).findings;

        paintFindings(container, findings, -1);
        paintFindings(container, findings, -1);

        expect(painted('gate-high')).toEqual(['10.0.0.4']);
    });

    it('takes every highlight off the page when asked', () => {
        const container = rendered('<p>host 10.0.0.4</p>');
        paintFindings(container, scanText('host 10.0.0.4', gate).findings, 0);
        expect(registry.size).toBeGreaterThan(0);

        clearFindings();

        expect(registry.size).toBe(0);
    });

    // A browser without the API — the API is all this needs — leaves the preview uncoloured, and
    // the navigator, which is what the reviewer actually walks with, works as before.
    it('does nothing at all where the browser has no Highlight API', () => {
        delete (globalThis as Record<string, unknown>).Highlight;
        const container = rendered('<p>host 10.0.0.4</p>');

        expect(paintFindings(container, scanText('host 10.0.0.4', gate).findings, 0)).toBeNull();
        expect(registry.size).toBe(0);
    });
});
