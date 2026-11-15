import { describe, expect, it } from 'vitest';
import { readDocumentText } from './documentText';
import { matchIndices, matchTextDirective, matchTextFragment } from './matchTextDirective';

const render = (html: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
};

const found = (text: string, directive: Parameters<typeof matchIndices>[1]): string | null => {
    const at = matchIndices(text, directive);
    return at ? text.slice(at[0], at[1]) : null;
};

describe('matchIndices', () => {
    it('finds the words, not the middle of a longer one', () => {
        const text = 'concatenate the cat';
        expect(matchIndices(text, { start: 'cat' })![0]).toBe(16);
    });

    it('reads a quote whose neighbours are punctuation', () => {
        expect(found('a note (drawn once) and read', { start: '(drawn' })).toBe('(drawn');
    });

    it('takes the first passage that reads alike when nothing tells them apart', () => {
        expect(matchIndices('see below and see below', { start: 'see below' })![0]).toBe(0);
    });

    it('is told them apart by a prefix', () => {
        expect(matchIndices('one see below and two see below', { prefix: 'two', start: 'see below' })![0])
            .toBe(22);
    });

    it('is told them apart by a suffix', () => {
        expect(matchIndices('see below then, see below here', { start: 'see below', suffix: 'here' })![0])
            .toBe(16);
    });

    it('takes context to sit against the passage, not merely somewhere near it', () => {
        expect(matchIndices('two words away see below', { prefix: 'two', start: 'see below' })).toBeNull();
    });

    it('stands for everything between its two ends', () => {
        expect(found('the frame is drawn once and read twice', { start: 'the frame', end: 'and read' }))
            .toBe('the frame is drawn once and read');
    });

    it('spans blocks between its ends, but never inside one term', () => {
        const text = 'the opening line\nand the closing line';
        expect(found(text, { start: 'opening line', end: 'closing line' }))
            .toBe('opening line\nand the closing line');
        expect(matchIndices(text, { start: 'opening line and' })).toBeNull();
    });

    it('finds nothing once the document no longer holds the words', () => {
        expect(matchIndices('the frame is drawn', { start: 'the canvas' })).toBeNull();
    });
});

describe('matchTextDirective', () => {
    it('reads a passage the renderer split over several nodes and lines', () => {
        const root = render('<p>The <b>frame</b> is\n   drawn once.</p><p>And read.</p>');
        const range = matchTextDirective(readDocumentText(root), { start: 'frame is drawn' })!;
        expect(range.toString().replace(/\s+/g, ' ')).toBe('frame is drawn');
    });

    it('is case-blind, so a heading capitalised by the stylesheet still resolves', () => {
        const root = render('<h2>The Frame</h2>');
        expect(matchTextDirective(readDocumentText(root), { start: 'the frame' })).not.toBeNull();
    });
});

describe('matchTextFragment', () => {
    it('takes the first passage the document still holds', () => {
        const document_ = readDocumentText(render('<p>the frame is drawn</p>'));
        const range = matchTextFragment(document_, [{ start: 'the canvas' }, { start: 'is drawn' }])!;
        expect(range.toString()).toBe('is drawn');
    });
});
