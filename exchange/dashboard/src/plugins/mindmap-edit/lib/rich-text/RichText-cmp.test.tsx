import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkerClientMockProvider } from 'kiao-worker';

// What a note's markdown is rendered against: the folder the browser is on, which relative image
// links are written against. No note here has one; the stub is what lets the render happen at all.
vi.mock('src/cms-core/files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));

import { RichTextCmp } from './RichText-cmp';

const note = (content: string) => render(
    <WorkerClientMockProvider mock={{ workerClient: { getDownloadUrl: (path: string) => path } as any }}>
        <RichTextCmp content={content} style={{}} />
    </WorkerClientMockProvider>,
);

describe('RichTextCmp', () => {
    // A note is a label on a canvas rather than a page being read: it is sized to its own text and
    // dragged by the hand that would otherwise have to reach past a button to grab it. The link
    // itself stays — a note linking to a document of the store is one of the things a map is for.
    it('draws a link to a document of the store without the crosshair beside it', () => {
        const { container } = note('[the frame](/units/abc/cadre.md)');

        expect(container.querySelector('a[href="/units/abc/cadre.md"]')).not.toBeNull();
        expect(container.querySelector('.cms-reveal-in-tree')).toBeNull();
    });

    // The form "Copy internal markdown link" puts on the clipboard: pasted into a note, it stays
    // a link to the passage — the router opens it in place, fragment and all.
    it('keeps the passage a stored link names', () => {
        const { container } = note('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');

        // Read off the attribute rather than matched in a selector: the `=` the fragment carries
        // is misparsed inside a quoted attribute value.
        expect(container.querySelector('a')?.getAttribute('href'))
            .toBe('/units/abc/cadre.md#text=is%20drawn%20once');
        expect(container.querySelector('.cms-reveal-in-tree')).toBeNull();
    });
});
