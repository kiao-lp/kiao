import { describe, expect, it } from 'vitest';
import { linkToPassage, parseTextFragment, textFragmentOf, TextDirective } from './textDirective';

describe('parseTextFragment', () => {
    it('reads a passage quoted whole', () => {
        expect(parseTextFragment('#text=hello%20world')).toEqual([{ start: 'hello world' }]);
    });

    it('reads the specification form too, wherever one can still be seen', () => {
        expect(parseTextFragment('#:~:text=hello%20world')).toEqual([{ start: 'hello world' }]);
        expect(parseTextFragment('#a-section:~:text=hello')).toEqual([{ start: 'hello' }]);
    });

    it('reads the four terms, marked by the hyphens that carry no other meaning', () => {
        expect(parseTextFragment('#text=before-,opening,closing,-after')).toEqual([
            { prefix: 'before', start: 'opening', end: 'closing', suffix: 'after' },
        ]);
    });

    it('leaves a fragment that names no passage alone', () => {
        expect(parseTextFragment('#a-section')).toEqual([]);
        expect(parseTextFragment('')).toEqual([]);
    });

    it('reads every passage a fragment names', () => {
        expect(parseTextFragment('#text=one&text=two')).toEqual([{ start: 'one' }, { start: 'two' }]);
    });

    it('does not read a lone term ending in a hyphen as a prefix with nothing to prefix', () => {
        expect(parseTextFragment('#text=well-')).toEqual([{ start: 'well-' }]);
    });

    it('drops what it cannot read rather than opening on the wrong words', () => {
        expect(parseTextFragment('#text=')).toEqual([]);
        expect(parseTextFragment('#text=a,b,c,d,e')).toEqual([]);
        expect(parseTextFragment('#selector=x')).toEqual([]);
    });
});

describe('textFragmentOf', () => {
    it('writes the terms under a fragment a page is allowed to read', () => {
        // The specification's `:~:` never reaches one: Chrome strips it from `location.hash` on
        // load and from any URL given to `history.pushState`.
        expect(textFragmentOf([{ start: 'here' }])).toBe('#text=here');
        expect(textFragmentOf([{ start: 'here' }])).not.toContain(':~:');
    });

    it('encodes what would otherwise be read as punctuation of the grammar', () => {
        expect(textFragmentOf([{ start: 'a, b & c' }])).toBe('#text=a%2C%20b%20%26%20c');
        expect(textFragmentOf([{ start: 'well-known' }])).toBe('#text=well%2Dknown');
        // A markdown link destination ends at an unbalanced parenthesis, and this is written into one.
        expect(textFragmentOf([{ start: 'a smiley :)' }])).toBe('#text=a%20smiley%20%3A%29');
    });

    it('writes the terms in their fixed order', () => {
        expect(textFragmentOf([{ prefix: 'p', start: 's', end: 'e', suffix: 'x' }]))
            .toBe('#text=p-,s,e,-x');
    });

    it('is nothing at all when there is no passage to name', () => {
        expect(textFragmentOf([])).toBe('');
    });

    it('round-trips every term, punctuation included', () => {
        const directives: TextDirective[] = [
            { prefix: 'the frame,', start: 'is drawn-once', end: 'and read & kept', suffix: '. Then' },
        ];
        expect(parseTextFragment(textFragmentOf(directives))).toEqual(directives);
    });
});

describe('linkToPassage', () => {
    it('replaces whatever fragment the link already carried', () => {
        expect(linkToPassage('/units/abc/cadre.md#old', [{ start: 'x' }]))
            .toBe('/units/abc/cadre.md#text=x');
    });

    it('leaves a link naming no passage without a fragment', () => {
        expect(linkToPassage('/units/abc/cadre.md', [])).toBe('/units/abc/cadre.md');
    });
});
