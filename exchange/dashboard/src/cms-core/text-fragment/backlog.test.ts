import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkerError } from 'kiao-worker';
import {
    BACKLOG_SUFFIX,
    addPassageToBacklog,
    appendBacklogSection,
    backlogPathFor,
    backlogSectionFor,
    backlogUrlFor,
    formatBacklogTimestamp,
    markdownLinkToPassage,
    storedPassageLink,
} from './backlog';

describe('backlogPathFor', () => {
    it('appends the companion suffix worker recognises', () => {
        expect(backlogPathFor('units/abc/cadre.md')).toBe('units/abc/cadre.md.blog.md');
        expect(BACKLOG_SUFFIX).toBe('.blog.md');
    });
});

describe('formatBacklogTimestamp', () => {
    it('writes local time sortable in a heading', () => {
        const date = new Date(2026, 8, 22, 8, 7);
        expect(formatBacklogTimestamp(date)).toBe('2026-09-22 08:07');
    });
});

describe('backlogSectionFor', () => {
    it('writes a heading, a stored passage link, and room for the comment', () => {
        const { heading, markdown } = backlogSectionFor(
            'is drawn once',
            '/units/abc/cadre.md#text=is%20drawn%20once',
            new Date(2026, 8, 22, 8, 47),
        );
        expect(heading).toBe('2026-09-22 08:47 — is drawn once');
        expect(markdown).toBe(
            '## 2026-09-22 08:47 — is drawn once\n\n' +
            '[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)\n\n',
        );
    });

    it('collapses the selection as it reads on screen, and escapes the link text', () => {
        const { markdown } = backlogSectionFor(
            '  the frame\nis   [drawn]  ',
            '/a.md#text=frame',
            new Date(2026, 8, 22, 8, 47),
        );
        expect(markdown).toContain('[the frame is \\[drawn\\]](/a.md#text=frame)');
        expect(markdown).toContain('## 2026-09-22 08:47 — the frame is [drawn]');
    });
});

describe('storedPassageLink', () => {
    it('names the passage bare: no domain, no mount point, fragment kept', () => {
        expect(storedPassageLink('units/abc/cadre.md', { start: 'is drawn once' }))
            .toBe('/units/abc/cadre.md#text=is%20drawn%20once');
    });
});

describe('markdownLinkToPassage', () => {
    it('quotes the passage as the label of its stored link', () => {
        expect(markdownLinkToPassage('units/abc/cadre.md', { start: 'is drawn once' }, 'is drawn once'))
            .toBe('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');
    });

    it('collapses the selection as it reads on screen, and escapes the label', () => {
        expect(markdownLinkToPassage('a.md', { start: 'frame' }, '  the frame\nis   [drawn]  '))
            .toBe('[the frame is \\[drawn\\]](/a.md#text=frame)');
    });

    it('quotes the whole selection rather than an excerpt of it', () => {
        const words = 'word '.repeat(30).trim();
        expect(markdownLinkToPassage('a.md', { start: 'word' }, words))
            .toBe(`[${words}](/a.md#text=word)`);
    });
});

describe('appendBacklogSection', () => {
    it('is the section alone when there is no backlog yet', () => {
        expect(appendBacklogSection('', '## new\n\n[x](/a)\n\n')).toBe('## new\n\n[x](/a)\n\n');
        expect(appendBacklogSection('\n  \n', '## new\n\n')).toBe('## new\n\n');
    });

    it('leaves exactly one blank line whatever the backlog ends with', () => {
        expect(appendBacklogSection('# old\n', '## new\n')).toBe('# old\n\n## new\n');
        expect(appendBacklogSection('# old\n\n', '## new\n')).toBe('# old\n\n## new\n');
        expect(appendBacklogSection('# old', '## new\n')).toBe('# old\n\n## new\n');
    });
});

describe('backlogUrlFor', () => {
    it('asks for the caret at the end and scrolls the preview to the heading', () => {
        const url = backlogUrlFor('units/abc/cadre.md.blog.md', '2026-09-22 08:47 — is drawn once');
        expect(url).toContain('/units/abc/cadre.md.blog.md?cursor=end#text=');
        // The heading survives the round trip: hyphens encoded, spaces escaped, no `:~:`.
        expect(url).not.toContain(':~:');
        expect(url).toContain('2026%2D09%2D22%2008%3A47');
    });
});

describe('addPassageToBacklog', () => {
    beforeEach(() => {
        vi.stubGlobal('open', vi.fn());
    });

    const clientFor = (existing: string | null) => ({
        getFileText: existing === null
            ? vi.fn().mockRejectedValue(new WorkerError('missing', 404, 'Not Found'))
            : vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(undefined),
    });

    it('creates the backlog with the section when there is none', async () => {
        const client = clientFor(null);
        await addPassageToBacklog(
            client as any, 'units/abc/cadre.md', { start: 'is drawn once' }, 'is drawn once',
        );

        expect(client.getFileText).toHaveBeenCalledWith('units/abc/cadre.md.blog.md');
        const written = client.update.mock.calls[0];
        expect(written[0]).toBe('units/abc/cadre.md.blog.md');
        expect(written[1]).toContain('[is drawn once](/units/abc/cadre.md#text=is%20drawn%20once)');
        expect(written[1].startsWith('## ')).toBe(true);

        const opened = (window.open as any).mock.calls[0];
        expect(opened[0]).toContain('/units/abc/cadre.md.blog.md?cursor=end#text=');
        expect(opened[1]).toBe('_blank');
    });

    it('appends after the existing backlog rather than replacing it', async () => {
        const client = clientFor('## 2026-09-21 10:00 — earlier\n\n[x](/a)\n\n');
        await addPassageToBacklog(
            client as any, 'units/abc/cadre.md', { start: 'later words' }, 'later words',
        );

        const written: string = client.update.mock.calls[0][1];
        expect(written.startsWith('## 2026-09-21 10:00 — earlier')).toBe(true);
        expect(written).toContain('[later words](/units/abc/cadre.md#text=later%20words)');
    });

    it('leaves a backlog that cannot be read to the caller rather than overwriting it', async () => {
        const client = {
            getFileText: vi.fn().mockRejectedValue(new WorkerError('boom', 500, 'Server Error')),
            update: vi.fn(),
        };
        await expect(addPassageToBacklog(
            client as any, 'units/abc/cadre.md', { start: 'x' }, 'x',
        )).rejects.toThrow();
        expect(client.update).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
    });
});
