import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Criticality, GateMatcher, parseCategory } from './matchers';
import { scanText } from './scan';
import { clearFindings, paintFindings } from './paintFindings';

// jsdom lacks the Highlight API; a fake registry pins the ranges.

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

// Renders HTML into a container.
const rendered = (html: string): HTMLElement => {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
};

// Highlight contents as strings.
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

    // Matching walks text nodes, not elements.
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

    // Findings absent from rendering stay listed; only painting skips them.
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

    // No paint without the Highlight API.
    it('does nothing at all where the browser has no Highlight API', () => {
        delete (globalThis as Record<string, unknown>).Highlight;
        const container = rendered('<p>host 10.0.0.4</p>');

        expect(paintFindings(container, scanText('host 10.0.0.4', gate).findings, 0)).toBeNull();
        expect(registry.size).toBe(0);
    });
});
