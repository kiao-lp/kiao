import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * How a word is worn. This used to be asserted through the board, back when the board
 * imported the chip; the board asks for the `tags.ui` capability now and does not know what one
 * looks like, so the colours are pinned where they are decided.
 */

vi.mock('./Tags-ctx', () => ({
    useTags: () => ({
        tags: [{ label: 'bug', color: '#e66767' }],
        ensureLoaded: () => { },
    }),
}));

import { TagChips } from './TagChip';

describe('TagChips — the colour a word is worn in', () => {
    it('wears each word in the colour the store gives it', () => {
        render(<TagChips labels={['bug']} />);
        const chip = screen.getByTestId('tag-chip');
        expect(chip).toHaveTextContent('bug');
        expect(chip).toHaveStyle({ background: '#e66767' });
    });

    // A document pasted in from another store, or written by hand, says what it says: the word is
    // worn in grey rather than dropped, since dropping it would edit somebody's document by
    // rendering it.
    it('wears a word the store has never named, in the neutral colour', () => {
        render(<TagChips labels={['whatever']} />);
        expect(screen.getByTestId('tag-chip')).toHaveStyle({ background: '#6b7280' });
    });

    it('draws nothing for a document wearing none', () => {
        const { container } = render(<TagChips labels={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
