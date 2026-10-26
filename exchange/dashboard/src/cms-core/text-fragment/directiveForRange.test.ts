import { describe, expect, it } from 'vitest';
import { directiveForRange } from './directiveForRange';
import { readDocumentText } from './documentText';
import { matchIndices, matchTextDirective } from './matchTextDirective';
import { parseTextFragment, textFragmentOf } from './textDirective';

const render = (html: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
};

/** A selection of the `occurrence`-th `needle` of the rendered document, as a reader would make it. */
const select = (root: HTMLElement, needle: string, occurrence = 0): Range => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        for (let at = data.indexOf(needle); at >= 0; at = data.indexOf(needle, at + 1)) {
            if (seen++ < occurrence) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            return range;
        }
    }
    throw new Error(`nothing reads "${needle}"`);
};

describe('directiveForRange', () => {
    it('quotes a short passage whole, with no context it does not need', () => {
        const root = render('<p>The frame is drawn once and read twice.</p>');
        const range = select(root, 'is drawn once');
        expect(directiveForRange(readDocumentText(root), range)).toEqual({ start: 'is drawn once' });
    });

    it('gives back the whole words a reader swept through the middle of', () => {
        const root = render('<p>The frame is drawn.</p>');
        expect(directiveForRange(readDocumentText(root), select(root, 'ram'))).toEqual({ start: 'frame' });
    });

    it('adds only the context that tells two identical passages apart', () => {
        const root = render('<p>see below for the frame.</p><p>and see below for the rest.</p>');
        const document_ = readDocumentText(root);
        const directive = directiveForRange(document_, select(root, 'see below', 1))!;

        expect(directive.start).toBe('see below');
        expect(directive.prefix ?? directive.suffix).toBeTruthy();
        expect(matchIndices(document_.text, directive)![0]).toBe(document_.text.lastIndexOf('see below'));
    });

    it('names a long passage by its two ends rather than putting it all in the URL', () => {
        const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar';
        const root = render(`<p>${words}</p>`);
        const directive = directiveForRange(readDocumentText(root), select(root, words))!;

        expect(directive.start).toBe('alpha bravo charlie delta echo');
        expect(directive.end).toBe('kilo lima mike november oscar');
    });

    it('names a passage crossing a paragraph by its two ends, which is the only form that can', () => {
        const root = render('<p>The frame is drawn.</p><p>And then read.</p>');
        const range = document.createRange();
        range.setStart(root.querySelectorAll('p')[0].firstChild!, 4);
        range.setEnd(root.querySelectorAll('p')[1].firstChild!, 8);

        const directive = directiveForRange(readDocumentText(root), range)!;
        expect(directive).toEqual({ start: 'frame is drawn.', end: 'and then' });
    });

    it('answers nothing for a selection holding no text of the document', () => {
        const root = render('<p>The frame.</p>');
        const range = document.createRange();
        range.selectNodeContents(render('<p>Elsewhere.</p>'));
        expect(directiveForRange(readDocumentText(root), range)).toBeNull();
    });
});

describe('a link written from a selection and followed back', () => {
    it('opens on the passage it was made from', () => {
        const root = render(
            '<h2>The Frame</h2><p>It is <b>drawn once</b> and read twice.</p><p>It is drawn once elsewhere.</p>',
        );
        const document_ = readDocumentText(root);
        const selected = select(root, 'drawn once', 1);

        const fragment = textFragmentOf([directiveForRange(document_, selected)!]);
        const followed = matchTextDirective(document_, parseTextFragment(fragment)[0])!;

        expect(followed.toString()).toBe('drawn once');
        expect(followed.compareBoundaryPoints(Range.START_TO_START, selected)).toBe(0);
    });
});
