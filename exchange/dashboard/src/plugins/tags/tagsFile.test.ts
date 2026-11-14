import { describe, expect, it } from 'vitest';
import {
    findTag, nextColor, normalizeLabel, paintForLabel, paintOf, readTags, TAG_PALETTE, tagsFileText,
    UNKNOWN_TAG_COLOR, withTag, writeTags,
} from './tagsFile';

/**
 * A tag is a word and a colour. The tests worth having are about the two rules that make it one:
 * reading is forgiving, because the file is hand-editable, and the word is the identity, because
 * that is what lets a document carry it.
 */
describe('the tags of a store', () => {
    it('reads the entries a file names', () => {
        expect(readTags([{ label: 'bug', color: '#E66767' }, { label: 'ui', color: '#3987e5' }]))
            .toEqual([{ label: 'bug', color: '#e66767' }, { label: 'ui', color: '#3987e5' }]);
    });

    it('drops what it cannot read, and gives a colourless tag the neutral one', () => {
        expect(readTags([
            'bug',                                  // not an object
            { color: '#e66767' },                   // no word, so no tag
            { label: '   ' },                       // nor is whitespace one
            { label: 'ops' },                       // a word and no colour: the neutral grey
            { label: 'ui', color: 'octarine' },     // a colour nobody can paint with
        ])).toEqual([
            { label: 'ops', color: UNKNOWN_TAG_COLOR },
            { label: 'ui', color: UNKNOWN_TAG_COLOR },
        ]);
        expect(readTags('nothing of the sort')).toEqual([]);
    });

    it('knows a word once, whatever case it was written in', () => {
        expect(readTags([{ label: 'Bug', color: '#111111' }, { label: 'bug', color: '#222222' }]))
            .toEqual([{ label: 'Bug', color: '#111111' }]);
    });

    it('collapses the whitespace a word was typed with', () => {
        expect(normalizeLabel('  needs   review  ')).toBe('needs review');
        expect(readTags([{ label: ' needs   review ' }])[0].label).toBe('needs review');
    });

    it('writes back the two fields and nothing else', () => {
        expect(writeTags([{ label: 'bug', color: '#e66767' }]))
            .toEqual([{ label: 'bug', color: '#e66767' }]);
        expect(tagsFileText([{ label: 'bug', color: '#e66767' }]))
            .toBe('[\n  {\n    "label": "bug",\n    "color": "#e66767"\n  }\n]\n');
    });

    it('round-trips a file it wrote', () => {
        const tags = [{ label: 'bug', color: '#e66767' }, { label: 'ui', color: '#3987e5' }];
        expect(readTags(JSON.parse(tagsFileText(tags)))).toEqual(tags);
    });
});

describe('the word as the identity', () => {
    const tags = [{ label: 'Bug', color: '#e66767' }];

    it('finds a tag whatever case the word is asked for in', () => {
        expect(findTag(tags, 'bug')?.label).toBe('Bug');
        expect(findTag(tags, '  BUG ')?.label).toBe('Bug');
        expect(findTag(tags, 'ui')).toBeNull();
    });

    it('wears a word the store has never named, in the neutral colour', () => {
        expect(paintForLabel(tags, 'bug').fill).toBe('#e66767');
        expect(paintForLabel(tags, 'whatever').fill).toBe(UNKNOWN_TAG_COLOR);
    });

    it('adds a word that is new and gives back the tag that is not', () => {
        const added = withTag(tags, 'ui');
        expect(added.tags.map(tag => tag.label)).toEqual(['Bug', 'ui']);
        expect(added.tag.label).toBe('ui');

        const known = withTag(tags, 'BUG');
        expect(known.tags).toBe(tags);
        expect(known.tag.label).toBe('Bug');
    });
});

describe('the colour a tag is given', () => {
    it('takes the first of the palette no tag holds', () => {
        expect(nextColor([])).toBe(TAG_PALETTE[0]);
        expect(nextColor([{ label: 'a', color: TAG_PALETTE[0] }])).toBe(TAG_PALETTE[1]);
    });

    it('starts the palette again past the eighth, rather than going grey', () => {
        const taken = TAG_PALETTE.map((color, index) => ({ label: `t${index}`, color }));
        expect(TAG_PALETTE).toContain(nextColor(taken));
        expect(nextColor(taken)).not.toBe(UNKNOWN_TAG_COLOR);
    });

    it('writes the word in whichever ink reads on the colour', () => {
        expect(paintOf('#ffffff').ink).toBe('#111827');
        expect(paintOf('#000000').ink).toBe('#ffffff');
        // A colour a hand-edited file said that is no colour at all falls back to the neutral one.
        expect(paintOf('rebeccapurple').fill).toBe(UNKNOWN_TAG_COLOR);
    });
});
