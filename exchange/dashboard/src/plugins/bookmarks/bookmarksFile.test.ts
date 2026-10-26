import { describe, expect, it } from 'vitest';
import {
    bookmarksFileText, indexOfPath, linkOfPath, newBookmark, pathOfLink, readBookmarks,
} from './bookmarksFile';

const FILE = [
    { title: 'The framing of a unit', link: '/units/abc/cadre.md', note: 'the one to copy from.' },
    { title: 'Anthropic', link: 'https://anthropic.com', note: '' },
];

describe('readBookmarks', () => {
    it('reads a bookmark as its title, its link and its note', () => {
        const [first, second] = readBookmarks(FILE);
        expect(first).toEqual({
            title: 'The framing of a unit',
            link: '/units/abc/cadre.md',
            note: 'the one to copy from.',
        });
        expect(second).toEqual({ title: 'Anthropic', link: 'https://anthropic.com', note: '' });
    });

    // The file may have been written by hand or by a turn: what it cannot say is dropped, and a
    // bookmark missing a field is a bookmark with that field empty rather than no bookmark.
    it('drops what is not a bookmark and empties what is not a string', () => {
        expect(readBookmarks([
            { title: 'kept', link: '/kept.md', note: 'yes' },
            null,
            'a string',
            ['a list'],
            { title: 42, link: null, note: { text: 'no' } },
        ])).toEqual([
            { title: 'kept', link: '/kept.md', note: 'yes' },
            { title: '', link: '', note: '' },
        ]);
    });

    it('has nothing to show for a store that has never bookmarked anything', () => {
        expect(readBookmarks(null)).toEqual([]);
        expect(readBookmarks('### [A](/a.md)')).toEqual([]);
    });

    it('reads back what it wrote', () => {
        expect(readBookmarks(JSON.parse(bookmarksFileText(FILE)))).toEqual(FILE);
    });
});

describe('bookmarksFileText', () => {
    it('is the three fields, pretty-printed, one entry per bookmark', () => {
        expect(bookmarksFileText(FILE)).toBe(
            '[\n'
            + '  {\n'
            + '    "title": "The framing of a unit",\n'
            + '    "link": "/units/abc/cadre.md",\n'
            + '    "note": "the one to copy from."\n'
            + '  },\n'
            + '  {\n'
            + '    "title": "Anthropic",\n'
            + '    "link": "https://anthropic.com",\n'
            + '    "note": ""\n'
            + '  }\n'
            + ']\n',
        );
    });
});

describe('linkOfPath', () => {
    it('is the path from the store root, with a leading slash', () => {
        expect(linkOfPath('units/abc/cadre.md')).toBe('/units/abc/cadre.md');
    });

    // A stored link keeps the percent-encoding it was written with, which the link fixer matches
    // in either form when the document moves.
    it('encodes what a writer of a link escapes', () => {
        expect(linkOfPath('backlog/board/10 To Test.tasks.md'))
            .toBe('/backlog/board/10%20To%20Test.tasks.md');
        expect(linkOfPath('notes/plan (old).md')).toBe('/notes/plan%20%28old%29.md');
    });

    it('is the root itself for the folder the store is', () => {
        expect(linkOfPath('')).toBe('/');
    });
});

describe('pathOfLink', () => {
    it('reads back the path a link was written from', () => {
        expect(pathOfLink(linkOfPath('backlog/board/10 To Test.tasks.md')))
            .toBe('backlog/board/10 To Test.tasks.md');
    });

    it('reads a path the link fixer wrote back raw just as well', () => {
        expect(pathOfLink('/smoke/Bilan (2026) & suite.md')).toBe('smoke/Bilan (2026) & suite.md');
    });

    it('is the document, not the heading of it a link points at', () => {
        expect(pathOfLink('/units/abc/cadre.md#exercices')).toBe('units/abc/cadre.md');
    });

    it('says nothing for a link that points at no document of the store', () => {
        expect(pathOfLink('https://anthropic.com')).toBeNull();
        expect(pathOfLink('#somewhere')).toBeNull();
        expect(pathOfLink('')).toBeNull();
    });
});

describe('indexOfPath', () => {
    it('finds the document that is bookmarked, whatever its link was encoded as', () => {
        const bookmarks = readBookmarks([
            { title: 'Ready', link: '/backlog/board/05%20Ready.tasks.md', note: '' },
        ]);
        expect(indexOfPath(bookmarks, 'backlog/board/05 Ready.tasks.md')).toBe(0);
    });

    it('says -1 for a document that is not', () => {
        expect(indexOfPath(readBookmarks(FILE), 'units/abc/podcast.md')).toBe(-1);
    });

    it('finds the store root, which is bookmarked as `/`', () => {
        const bookmarks = readBookmarks([{ title: 'Everything', link: '/', note: '' }]);
        expect(indexOfPath(bookmarks, '')).toBe(0);
    });
});

describe('newBookmark', () => {
    it('is the title and the link, with nothing said about it yet', () => {
        expect(newBookmark('cadre.md', '/units/abc/cadre.md'))
            .toEqual({ title: 'cadre.md', link: '/units/abc/cadre.md', note: '' });
    });
});
