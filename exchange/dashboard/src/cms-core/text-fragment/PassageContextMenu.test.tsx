import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkerClientMockProvider, WorkerError } from 'kiao-worker';
import { PassageContextMenu } from './PassageContextMenu';

/**
 * The menu and the browser's own are mutually exclusive — whichever opens, the other does not — so
 * what is asserted here is the choice between them, and that it is made per click.
 */

const written = vi.fn<(text: string) => Promise<void>>();
const opened = vi.fn();
const client = {
    getFileText: vi.fn<(path: string) => Promise<string>>(),
    update: vi.fn<(path: string, content: string) => Promise<void>>(),
};

beforeEach(() => {
    written.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: written }, configurable: true });
    window.getSelection()?.removeAllRanges();
    opened.mockReset();
    vi.stubGlobal('open', opened);
    client.getFileText.mockReset().mockRejectedValue(new WorkerError('missing', 404, 'Not Found'));
    client.update.mockReset().mockResolvedValue(undefined);
});

const draw = (path: string | null = 'units/abc/cadre.md') => {
    const { container } = render(
        <WorkerClientMockProvider mock={{ workerClient: client as any }}>
            <PassageContextMenu path={path}>
                <p>The frame is drawn once and read twice.</p>
            </PassageContextMenu>
        </WorkerClientMockProvider>,
    );
    return container.querySelector('p')!;
};

/** A reader sweeping through `needle`, as the browser leaves the selection on right-click. */
const selectIn = (paragraph: HTMLElement, needle: string) => {
    const text = paragraph.firstChild as Text;
    const at = text.data.indexOf(needle);
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + needle.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
};

/**
 * Whether the browser is left to draw its own menu. It draws it unless something takes the click's
 * default away, which is exactly what Ant Design's trigger does when it opens one of ours.
 */
const browserKeepsItsMenu = (paragraph: HTMLElement): boolean => fireEvent.contextMenu(paragraph);

describe('a right-click in the preview', () => {
    it('is left to the browser when nothing is selected', () => {
        expect(browserKeepsItsMenu(draw())).toBe(true);
    });

    it('is left to the browser when the pane is showing no document of the store', () => {
        const paragraph = draw(null);
        selectIn(paragraph, 'frame');
        expect(browserKeepsItsMenu(paragraph)).toBe(true);
    });

    it('is taken over when it lands on selected text', async () => {
        const paragraph = draw();
        selectIn(paragraph, 'frame');
        expect(browserKeepsItsMenu(paragraph)).toBe(false);
        expect(await screen.findByText('Copy link to this passage')).toBeInTheDocument();
    });
});

describe('the passage menu', () => {
    it('offers the link to what was selected, and copies it whole', async () => {
        const paragraph = draw();
        selectIn(paragraph, 'is drawn once');
        fireEvent.contextMenu(paragraph);

        fireEvent.click(await screen.findByText('Copy link to this passage'));

        await waitFor(() => expect(written).toHaveBeenCalled());
        const copied = written.mock.calls[0][0];
        expect(copied.startsWith(window.location.origin)).toBe(true);
        expect(copied.endsWith('/units/abc/cadre.md#text=is%20drawn%20once')).toBe(true);
    });

    it('offers the passage as a stored markdown link, for a document or a mindmap note', async () => {
        const paragraph = draw();
        selectIn(paragraph, 'is drawn once');
        fireEvent.contextMenu(paragraph);

        fireEvent.click(await screen.findByText('Copy internal markdown link'));

        await waitFor(() => expect(written).toHaveBeenCalled());
        expect(written.mock.calls[0][0])
            .toBe('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');
    });

    it('still offers the plain copy the browser menu it replaced was offering', async () => {
        const paragraph = draw();
        selectIn(paragraph, 'is drawn once');
        fireEvent.contextMenu(paragraph);

        fireEvent.click(await screen.findByText('Copy'));

        await waitFor(() => expect(written).toHaveBeenCalledWith('is drawn once'));
    });

    it('offers to add the passage to the backlog, writes the section and opens it', async () => {
        const paragraph = draw();
        selectIn(paragraph, 'is drawn once');
        fireEvent.contextMenu(paragraph);

        fireEvent.click(await screen.findByText('Add to the backlog'));

        await waitFor(() => expect(client.update).toHaveBeenCalled());
        expect(client.getFileText).toHaveBeenCalledWith('units/abc/cadre.md.blog.md');
        const [path, content] = client.update.mock.calls[0];
        expect(path).toBe('units/abc/cadre.md.blog.md');
        expect(content).toContain('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');
        expect(content.startsWith('## ')).toBe(true);

        await waitFor(() => expect(opened).toHaveBeenCalled());
        const [url, target] = opened.mock.calls[0];
        expect(url).toContain('/units/abc/cadre.md.blog.md?cursor=end#text=');
        expect(target).toBe('_blank');
    });
});
