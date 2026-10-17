import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WorkerClientMockProvider } from 'kiao-worker';

// The renderer asks the browsing context which folder the open document is in. Stub it so a test
// can render as though any folder were open.
const browsing = vi.hoisted(() => ({ currentPath: '' }));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: browsing.currentPath }),
}));

import { ConfiguredMarkdown } from './ConfiguredMarkdown';

// ── Where a picture is fetched from ───────────────────────────────────────────
//
// Worker takes root-relative paths only, so what is pinned here is the join that turns a link
// written against the document into one: without it every relative image in a document below the
// store root was looked for at the root, and came back a 404.

const workerClient = { getDownloadUrl: (path: string) => `/api/files/download/${path}` };

const document = (markdown: string, documentFolder?: string) => (
    <WorkerClientMockProvider mock={{ workerClient: workerClient as any }}>
        <ConfiguredMarkdown documentFolder={documentFolder}>{markdown}</ConfiguredMarkdown>
    </WorkerClientMockProvider>
);

const show = (markdown: string, documentFolder?: string) => render(document(markdown, documentFolder));

/** The `src` the renderer settled on — it resolves asynchronously, showing a placeholder until then. */
const imageSrc = async (container: HTMLElement): Promise<string | null | undefined> => {
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    return container.querySelector('img')?.getAttribute('src');
};

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
        // What the Claude panel does: a path in a reply is written against the conversation's
        // working folder, which is not the folder the file browser happens to be showing.
        browsing.currentPath = 'units/xyz';
        const { container } = show('![](shot.png)', 'units/abc');

        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/shot.png');
    });
});

// ── What a re-render leaves standing ──────────────────────────────────────────
//
// The renderer is handed the same markdown again far more often than that markdown changes: a
// document re-renders because something around it did. The Claude panel is the clearest case — the
// text being typed into the message box re-renders the transcript above it at every keystroke — and
// what made this worth pinning down: each of those renders took every diagram in the transcript
// down and drew it again from nothing, and mermaid draws in a node the size of the diagram, which
// flickered a scrollbar around the whole window on each keypress.

describe('ConfiguredMarkdown — a render of markdown that has not changed', () => {
    it('leaves a drawn diagram where it stands', () => {
        browsing.currentPath = 'units/abc';
        const markdown = '```mermaid\ngraph TD;\n  A-->B;\n```';
        const { container, rerender } = render(document(markdown));
        const drawn = container.querySelector('.mermaid');

        rerender(document(markdown));

        // The very same node, not one that merely looks like it: a replacement is a diagram drawn
        // a second time.
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

// ── The crosshair beside a link ────────────────────────────────────────────────
//
// A link is where one meets a document one has not placed yet, and following it is not the only
// thing one may want to do about that. What the crosshair does with the path is the navigation
// tree's own test (FileTree-cmp); here it is a matter of which links get one.

/** The crosshairs the render put beside its links, by the document each one points at. */
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

    // The prefix:: schemes belong to the plugin that registered them: that plugin draws the whole
    // link, and what goes beside it is its business rather than the renderer's.
    it('leaves a link a plugin draws itself alone', () => {
        const { container } = show('[the unit](unit::/units/abc/abc.mlunit.json)');

        expect(crosshairs(container)).toEqual([]);
    });

    // A render that is not a page being read — a mindmap note, which is a label on a canvas.
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

// ── A kiao:diagram block ─────────────────────────────────────────────────────
//
// One file, one render on each side: GitHub hides the comment and shows the picture,
// kiao restores the fence from the comment and hides the picture. What is pinned here is
// kiao's half — the native diagram standing where the comment was, and no image beside it.

describe('ConfiguredMarkdown — a kiao:diagram block', () => {
    // The carried source is escaped as `Render diagrams` writes it: an `A-->B` left raw would
    // close the comment early, on GitHub as in the preview.
    const wrapped = (language: string, code: string, href = 'Doc.assets/01-mermaid.svg') => [
        '<!-- kiao:diagram',
        `\`\`\`${language}`,
        code.replace(/&/g, '&amp;').replace(/-->/g, '--&gt;'),
        '```',
        '-->',
        `![diagram](${href})`,
    ].join('\n');

    it('draws the carried fence as its native diagram and hides the companion picture', () => {
        browsing.currentPath = 'units/abc';
        const { container } = show(wrapped('mermaid', 'graph TD;\n  A-->B;'));

        expect(container.querySelector('.mermaid')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });

    it('keeps a picture standing after a plain fence', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show('```mermaid\ngraph TD;\n```\n\n![](shot.png)');

        expect(container.querySelector('.mermaid')).not.toBeNull();
        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/shot.png');
    });

    it('keeps the picture when the carried language is none kiao draws', async () => {
        browsing.currentPath = 'units/abc';
        const { container } = show(wrapped('d2', 'x -> y', 'Doc.assets/01-d2.svg'));

        expect(container.querySelector('.mermaid')).toBeNull();
        expect(await imageSrc(container)).toBe('/api/files/download/units/abc/Doc.assets/01-d2.svg');
    });
});
