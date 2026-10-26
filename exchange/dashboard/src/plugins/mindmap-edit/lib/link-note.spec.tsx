import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfiguredMarkdown } from '@cms-core';
import { WorkerClientMockProvider } from 'kiao-worker';

import { faviconUrl, findFavicon, linkNoteContent } from './link-note';

describe('faviconUrl', () => {
    it('points at the conventional location on the link origin', () => {
        expect(faviconUrl('https://example.com/some/deep/page?q=1#frag'))
            .toBe('https://example.com/favicon.ico');
        expect(faviconUrl('http://example.com:8080/page')).toBe('http://example.com:8080/favicon.ico');
    });

    it('has nothing to look for on links that are not web pages', () => {
        // Relative links point inside the CMS, which has no favicon to show.
        expect(faviconUrl('./sibling.md')).toBeNull();
        expect(faviconUrl('../parent.md')).toBeNull();
        expect(faviconUrl('/absolute/in/cms.md')).toBeNull();
        expect(faviconUrl('mailto:someone@example.com')).toBeNull();
        expect(faviconUrl('')).toBeNull();
    });
});

describe('linkNoteContent', () => {
    it('keeps the plain link when there is no favicon', () => {
        expect(linkNoteContent('https://example.com/page', null))
            .toBe('[{{{Title}}}](https://example.com/page)');
    });

    it('puts a sized favicon inside the link label', () => {
        expect(linkNoteContent('https://example.com/page', 'https://example.com/favicon.ico'))
            .toBe('[<img src="https://example.com/favicon.ico" alt="" width="16" height="16" /> {{{Title}}}](https://example.com/page)');
    });

    // The one non-obvious step: the note is markdown, but the icon is raw HTML inside the link
    // label. This asserts the renderer keeps it there — an <img> inside the <a>, at its stated
    // size — rather than escaping it or hoisting it out of the link.
    it('renders as a sized icon inside the link', async () => {
        const content = linkNoteContent('https://example.com/page', 'https://example.com/favicon.ico');
        const { container } = render(
            <WorkerClientMockProvider mock={{ workerClient: {} as any }}>
                <ConfiguredMarkdown>{content}</ConfiguredMarkdown>
            </WorkerClientMockProvider>,
        );

        // The picture resolves asynchronously, showing a placeholder until then.
        await waitFor(() => expect(container.querySelector('a[href="https://example.com/page"] img')).not.toBeNull());
        const icon = container.querySelector('a[href="https://example.com/page"] img');
        expect(icon).not.toBeNull();
        expect(icon?.getAttribute('src')).toBe('https://example.com/favicon.ico');
        expect(icon?.getAttribute('width')).toBe('16');
        expect(container.textContent).toContain('{{{Title}}}');
    });
});

// findFavicon decides on the <img> load outcome, which jsdom never produces on its own: the
// stub below plays the browser, so each branch (loads / fails / never answers) is exercised.
type ImageStub = { onload: (() => void) | null; onerror: (() => void) | null; naturalWidth: number; src: string };

const stubImage = (behaviour: (image: ImageStub) => void) => {
    vi.stubGlobal('Image', function (this: ImageStub) {
        this.onload = null;
        this.onerror = null;
        this.naturalWidth = 0;
        Object.defineProperty(this, 'src', {
            set: () => queueMicrotask(() => behaviour(this)),
        });
    });
};

describe('findFavicon', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('reports the icon when it decodes as an image', async () => {
        stubImage((image) => { image.naturalWidth = 32; image.onload?.(); });
        await expect(findFavicon('https://example.com/page')).resolves.toBe('https://example.com/favicon.ico');
    });

    it('reports nothing when the site serves no favicon', async () => {
        stubImage((image) => image.onerror?.());
        await expect(findFavicon('https://example.com/page')).resolves.toBeNull();
    });

    // A 404 page served as the favicon loads but decodes to nothing; it must not reach the note.
    it('reports nothing when the answer decodes to an empty image', async () => {
        stubImage((image) => { image.naturalWidth = 0; image.onload?.(); });
        await expect(findFavicon('https://example.com/page')).resolves.toBeNull();
    });

    // A silent host must not hold up the paste: the note is created without an icon.
    it('gives up on a site that never answers', async () => {
        vi.useFakeTimers();
        stubImage(() => { /* never settles */ });
        const pending = findFavicon('https://example.com/page');
        await vi.advanceTimersByTimeAsync(5000);
        await expect(pending).resolves.toBeNull();
    });

    it('does not probe relative links', async () => {
        const image = vi.fn();
        vi.stubGlobal('Image', image);
        await expect(findFavicon('./sibling.md')).resolves.toBeNull();
        expect(image).not.toHaveBeenCalled();
    });
});
