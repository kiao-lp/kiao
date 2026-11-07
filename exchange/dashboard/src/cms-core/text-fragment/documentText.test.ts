import { describe, expect, it } from 'vitest';
import { rangeIndices, rangeOf, readDocumentText } from './documentText';

const render = (html: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
};

const textOf = (html: string): string => readDocumentText(render(html)).text;

describe('readDocumentText', () => {
    it('reads the words, not the source that produced them', () => {
        expect(textOf('<p>Hello   world</p>')).toBe('hello world');
    });

    it('joins what the renderer split across nodes', () => {
        expect(textOf('<p>the <b>frame</b> is drawn</p>')).toBe('the frame is drawn');
    });

    it('reads a sentence wrapped over two source lines as the one line it is on screen', () => {
        expect(textOf('<p>the frame\n   is drawn</p>')).toBe('the frame is drawn');
    });

    it('keeps one block from running into the next', () => {
        expect(textOf('<p>one</p>\n<p>two</p>')).toBe('one\ntwo');
        expect(textOf('<ul><li>one</li><li>two</li></ul>')).toBe('one\ntwo');
    });

    it('ends on the document rather than on a break', () => {
        expect(textOf('<p>one</p>')).toBe('one');
    });

    it('leaves out what the renderer drew around the document', () => {
        expect(textOf('<p>kept</p><button>Copy HTML</button>')).toBe('kept');
        expect(textOf('<p>kept</p><div aria-hidden="true">dropped</div>')).toBe('kept');
    });
});

describe('rangeOf', () => {
    it('gives back the DOM the text was read from, across the nodes it was split over', () => {
        const root = render('<p>the <b>frame</b> is drawn</p>');
        const document_ = readDocumentText(root);
        const at = document_.text.indexOf('frame is');
        const range = rangeOf(document_, at, at + 'frame is'.length)!;
        expect(range.toString()).toBe('frame is');
    });

    it('answers nothing for a run whose end is a block boundary', () => {
        const document_ = readDocumentText(render('<p>one</p><p>two</p>'));
        expect(rangeOf(document_, 0, 4)).toBeNull();
    });
});

describe('rangeIndices', () => {
    it('places a DOM range back in the read text', () => {
        const root = render('<p>the frame is drawn</p>');
        const document_ = readDocumentText(root);
        const text = root.querySelector('p')!.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, 4);
        range.setEnd(text, 9);
        expect(rangeIndices(document_, range)).toEqual([4, 9]);
        expect(document_.text.slice(4, 9)).toBe('frame');
    });

    it('answers nothing for a range holding no text of the document', () => {
        const root = render('<p>one</p>');
        const document_ = readDocumentText(root);
        const other = render('<p>elsewhere</p>');
        const range = document.createRange();
        range.selectNodeContents(other);
        expect(rangeIndices(document_, range)).toBeNull();
    });
});
