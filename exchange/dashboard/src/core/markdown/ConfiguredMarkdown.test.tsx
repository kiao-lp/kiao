import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WorkerClientMockProvider } from 'kiao-worker';

// Stub the browsed folder so tests can render in any folder.
const browsing = vi.hoisted(() => ({ currentPath: '' }));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: browsing.currentPath }),
}));

import { ConfiguredMarkdown } from './ConfiguredMarkdown';

const workerClient = { getDownloadUrl: (path: string) => `/api/files/download/${path}` };

const document = (markdown: string, documentFolder?: string) => (
    <WorkerClientMockProvider mock={{ workerClient: workerClient as any }}>
        <ConfiguredMarkdown documentFolder={documentFolder}>{markdown}</ConfiguredMarkdown>
    </WorkerClientMockProvider>
);

const show = (markdown: string, documentFolder?: string) => render(document(markdown, documentFolder));

const imageSrc = async (container: HTMLElement): Promise<string | null | undefined> => {
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    return container.querySelector('img')?.getAttribute('src');
};

it('shows a code block immediately and adds its syntax colours when the engine is ready', async () => {
    const { container } = show('```javascript\nconst value = 1;\n```');
    expect(container.querySelector('code')?.textContent).toBe('const value = 1;');
    await waitFor(() => expect(container.querySelector('code span')).not.toBeNull());
});

describe('ConfiguredMarkdown — YAML front matter', () => {
    it('hides the header and keeps body source lines for scroll sync and block editing', () => {
        const { container } = render(
            <WorkerClientMockProvider mock={{ workerClient: workerClient as any }}>
                <ConfiguredMarkdown sourceLineAttributes>
                    {'---\ndocument:\n  status: DRAFT\n  role: DERIVED\n  provenance: A source report.\nstatus: "accepted"\ndate: 2026-11-12\ntags: ["Hidden decision metadata."]\nconsulted: []\n---\n\n# Visible title\n\nBody text.\n'}
                </ConfiguredMarkdown>
            </WorkerClientMockProvider>,
        );
        expect(container.textContent).not.toContain('DRAFT');
        expect(container.textContent).not.toContain('provenance');
        expect(container.textContent).not.toContain('Hidden decision metadata.');
        expect(container.textContent).not.toContain('accepted');
        expect(container.querySelector('h1')).toHaveTextContent('Visible title');
        expect(container.querySelector('h1')).toHaveAttribute('data-source-line', '12');
        expect(container.querySelector('p')).toHaveTextContent('Body text.');
    });

    it('keeps horizontal rules and YAML examples in the body', () => {
        const { container } = show('# Title\n\n---\n\n```yaml\ndocument:\n  status: DRAFT\n```\n');
        expect(container.querySelector('hr')).not.toBeNull();
        expect(container.querySelector('code')).toHaveTextContent('status: DRAFT');
    });

    it('hides a closed header even while its YAML is invalid', () => {
        const { container } = show('---\ndocument:\n  status: [unfinished\n---\n\n# Visible title');
        expect(container.textContent).not.toContain('unfinished');
        expect(container.querySelector('h1')).toHaveTextContent('Visible title');
    });
});

describe('ConfiguredMarkdown — an image link of the open document', () => {
    it('fetches a sibling picture from the folder the document is in', async () => {
        browsing.currentPath = 'exchange/dashboard/src/kit/archdia/docs';
        const { container } = show('![a diagram](Urb.svg)');

        expect(await imageSrc(container))
            .toBe('/api/files/download/exchange/dashboard/src/kit/archdia/docs/Urb.svg');
    });

    it('fetches the asset folder a static version writes', async () => {
        browsing.currentPath = 'docs';
        const { container } = show('![](design.assets/01-mermaid.svg)');

        expect(await imageSrc(container)).toBe('/api/files/download/docs/design.assets/01-mermaid.svg');
    });

    it('leaves a link that names the store root where it points', async () => {
        browsing.currentPath = 'units/xyz';
        const { container } = show('![](/units/abc/shot.png)');

        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/shot.png');
    });

    it('decodes the escapes a path with a space is written with', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show('![](mon%20image.png)');

        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/mon image.png');
    });

    it('hands an embedded image straight to the browser', async () => {
        browsing.currentPath = 'units/abc';
        const data = 'data:image/png;base64,iVBORw0KGgo=';
        const { container } = show(`![](${data})`);

        expect(await imageSrc(container)).toBe(data);
    });

    it('takes the folder it is given over the one being browsed', async () => {
        browsing.currentPath = 'units/xyz';
        const { container } = show('![](shot.png)', 'units/abc');

        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/shot.png');
    });
});

describe('ConfiguredMarkdown — a render of markdown that has not changed', () => {
    it('leaves a drawn diagram where it stands', async () => {
        browsing.currentPath = 'units/abc';
        const markdown = '```mermaid\ngraph TD;\n  A-->B;\n```';
        const { container, rerender } = render(document(markdown));
        await waitFor(() => expect(container.querySelector('.mermaid')).not.toBeNull());
        const drawn = container.querySelector('.mermaid');

        rerender(document(markdown));

        expect(drawn).not.toBeNull();
        expect(container.querySelector('.mermaid')).toBe(drawn);
    });

    it('leaves a picture where it stands, rather than fetching it again', async () => {
        browsing.currentPath = 'units/abc';
        const markdown = '![](shot.png)';
        const { container, rerender } = render(document(markdown));
        await imageSrc(container);
        const picture = container.querySelector('img');

        rerender(document(markdown));

        expect(container.querySelector('img')).toBe(picture);
    });
});

const crosshairs = (container: HTMLElement): (string | null)[] =>
    Array.from(container.querySelectorAll('.cms-reveal-in-tree'))
        .map(button => button.previousElementSibling?.getAttribute('href') ?? null);

describe('ConfiguredMarkdown — where a link points', () => {
    it('puts a crosshair beside a link to another document of the store', () => {
        const { container } = show('Read [the frame](/units/abc/cadre.md) first.');

        expect(crosshairs(container)).toEqual(['/units/abc/cadre.md']);
    });

    it('leaves a link out of the store alone', () => {
        const { container } = show([
            '[the web](https://ailleurs.fr/a.md)',
            '[a heading of this page](#un-titre)',
            '[an address](mailto:a@b.fr)',
        ].join('\n\n'));

        expect(crosshairs(container)).toEqual([]);
    });

    it('leaves a link a plugin draws itself alone', () => {
        const { container } = show('[the unit](unit::/units/abc/abc.mlunit.json)');

        expect(crosshairs(container)).toEqual([]);
    });

    it('leaves every link bare where the render says it is not a page', () => {
        const { container } = render(
            <WorkerClientMockProvider mock={{ workerClient: workerClient as any }}>
                <ConfiguredMarkdown revealLinkTargets={false}>
                    Read [the frame](/units/abc/cadre.md) first.
                </ConfiguredMarkdown>
            </WorkerClientMockProvider>,
        );

        expect(container.querySelector('a')).not.toBeNull();
        expect(crosshairs(container)).toEqual([]);
    });
});

describe('ConfiguredMarkdown — a kiao:diagram block', () => {
    // Carried source is escaped; raw `A-->B` would close the comment.
    const wrapped = (language: string, code: string, href = 'Doc.assets/01-mermaid.svg') => [
        '<!-- kiao:diagram',
        `\`\`\`${language}`,
        code.replace(/&/g, '&amp;').replace(/-->/g, '--&gt;'),
        '```',
        '-->',
        `![diagram](${href})`,
    ].join('\n');

    it('draws the carried fence as its native diagram and hides the companion picture', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show(wrapped('mermaid', 'graph TD;\n  A-->B;'));

        await waitFor(() => expect(container.querySelector('.mermaid')).not.toBeNull());
        expect(container.querySelector('img')).toBeNull();
    });

    it('keeps a picture standing after a plain fence', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show('```mermaid\ngraph TD;\n```\n\n![](shot.png)');

        await waitFor(() => expect(container.querySelector('.mermaid')).not.toBeNull());
        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/shot.png');
    });

    it('keeps the picture when the carried language is none kiao draws', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show(wrapped('d2', 'x -> y', 'Doc.assets/01-d2.svg'));

        expect(container.querySelector('.mermaid')).toBeNull();
        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/Doc.assets/01-d2.svg');
    });
});
