import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkerClientMockProvider } from 'kiao-worker';

vi.mock('src/core/files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));

import { RichTextCmp } from './RichText-cmp';

const note = (content: string) => render(
    <WorkerClientMockProvider mock={{ workerClient: { getDownloadUrl: (path: string) => path } as any }}>
        <RichTextCmp content={content} style={{}} />
    </WorkerClientMockProvider>,
);

describe('RichTextCmp', () => {
    it('draws a link to a document of the store without the crosshair beside it', () => {
        const { container } = note('[the frame](/units/abc/cadre.md)');

        expect(container.querySelector('a[href="/units/abc/cadre.md"]')).not.toBeNull();
        expect(container.querySelector('.cms-reveal-in-tree')).toBeNull();
    });

    it('keeps the passage a stored link names', () => {
        const { container } = note('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');

        expect(container.querySelector('a')?.getAttribute('href'))
            .toBe('/units/abc/cadre.md#text=is%20drawn%20once');
        expect(container.querySelector('.cms-reveal-in-tree')).toBeNull();
    });
});
