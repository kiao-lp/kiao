import React, { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./passageHighlight', () => ({
    paintPassage: vi.fn(),
    clearPassage: vi.fn(),
    // jsdom lays nothing out, so the real one could never report the passage placed.
    revealPassage: vi.fn(() => true),
}));

import { clearPassage, paintPassage } from './passageHighlight';
import { useTextFragment } from './useTextFragment';

const Pane: React.FC<{ document: string }> = ({ document: html }) => {
    const pane = useRef<HTMLDivElement>(null);
    const { active } = useTextFragment(pane);
    return <div ref={pane} data-active={active} dangerouslySetInnerHTML={{ __html: html }} />;
};

const open = (url: string, document_ = '<p>The frame is drawn once.</p><p>And read twice.</p>') =>
    render(<MemoryRouter initialEntries={[url]}><Pane document={document_} /></MemoryRouter>);

beforeEach(() => {
    vi.mocked(paintPassage).mockClear();
    vi.mocked(clearPassage).mockClear();
});

describe('opening a document on the passage its URL names', () => {
    it('paints the passage the fragment quotes', async () => {
        open('/a.md#text=frame%20is%20drawn');
        await waitFor(() => expect(paintPassage).toHaveBeenCalled());
        expect(vi.mocked(paintPassage).mock.calls[0][0].toString()).toBe('frame is drawn');
    });

    it('reads a passage that runs from one paragraph into the next', async () => {
        open('/a.md#text=drawn%20once,and%20read');
        await waitFor(() => expect(paintPassage).toHaveBeenCalled());
        expect(vi.mocked(paintPassage).mock.calls[0][0].toString()).toContain('drawn once');
    });

    it('leaves a document whose URL names no passage alone', () => {
        const { container } = open('/a.md');
        expect(paintPassage).not.toHaveBeenCalled();
        expect(container.querySelector('[data-active="false"]')).not.toBeNull();
    });

    it('paints nothing when the document no longer holds the words', async () => {
        open('/a.md#text=the%20canvas');
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(paintPassage).not.toHaveBeenCalled();
    });

    it('takes the highlight away with it when the reader leaves', async () => {
        const { unmount } = open('/a.md#text=frame');
        await waitFor(() => expect(paintPassage).toHaveBeenCalled());
        unmount();
        expect(clearPassage).toHaveBeenCalled();
    });
});
