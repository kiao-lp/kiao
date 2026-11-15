/** Backlog: `<doc>.blog.md` companion (see `subsidiary.go`). Stored links use bare path + `#text=`. Append scrolls via `useTextFragment`, caret via `?cursor=end`. */

import { WorkerClient, WorkerError } from 'kiao-worker';
import { resolveInternalLink, storedLinkOf } from '../navigation/internal-links';
import { linkToPassage, textFragmentOf, TextDirective } from './textDirective';

/** The companion suffix worker recognises as a backlog. */
export const BACKLOG_SUFFIX = '.blog.md';

/** `units/abc/cadre.md` -> `units/abc/cadre.md.blog.md`. */
export const backlogPathFor = (sourcePath: string): string => `${sourcePath}${BACKLOG_SUFFIX}`;

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncate = (text: string, max: number): string =>
    text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Escape `\`, `[`, `]` so link text stays literal. */
const escapeLinkText = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Local time, sortable and readable in a heading: `2026-09-22 08:47`. */
export const formatBacklogTimestamp = (date: Date): string =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

export interface BacklogSection {
    /** Heading text without `##`; also the scroll target. */
    heading: string;
    markdown: string;
}
export const backlogSectionFor = (
    passageText: string,
    passageLink: string,
    date: Date = new Date(),
): BacklogSection => {
    const excerpt = truncate(collapseWhitespace(passageText), 80);
    const headingExcerpt = truncate(collapseWhitespace(passageText), 60);
    const heading = `${formatBacklogTimestamp(date)} — ${headingExcerpt}`;
    const markdown = `## ${heading}\n\n[${escapeLinkText(excerpt)}](${passageLink})\n\n`;
    return { heading, markdown };
};

/** Stored form: bare path + `#text=` fragment, no domain or mount. */
export const storedPassageLink = (sourcePath: string, directive: TextDirective): string =>
    linkToPassage(storedLinkOf(sourcePath), [directive]);

/** `[words](/path#text=…)` with untruncated, bracket-escaped label. */
export const markdownLinkToPassage = (
    sourcePath: string,
    directive: TextDirective,
    passageText: string,
): string =>
    `[${escapeLinkText(collapseWhitespace(passageText))}](${storedPassageLink(sourcePath, directive)})`;

/** Appends with exactly one blank line between sections. */
export const appendBacklogSection = (existing: string, section: string): string => {
    if (existing.trim() === '') return section;
    const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return existing + separator + section;
};

/** Backlog URL: `?cursor=end` before `#text=` fragment. */
export const backlogUrlFor = (backlogPath: string, heading: string): string =>
    resolveInternalLink(`${storedLinkOf(backlogPath)}?cursor=end${textFragmentOf([{ start: heading }])}`);

/** Appends to backlog, creating it if missing. Only 404 reads as empty; other errors propagate. */
export const addPassageToBacklog = async (
    client: WorkerClient,
    sourcePath: string,
    directive: TextDirective,
    passageText: string,
): Promise<void> => {
    const backlogPath = backlogPathFor(sourcePath);
    const passageLink = storedPassageLink(sourcePath, directive);
    const { heading, markdown } = backlogSectionFor(passageText, passageLink);

    let existing = '';
    try {
        existing = await client.getFileText(backlogPath);
    } catch (error) {
        if (!(error instanceof WorkerError && error.response.status === 404)) throw error;
    }

    await client.update(backlogPath, appendBacklogSection(existing, markdown));
    window.open(backlogUrlFor(backlogPath, heading), '_blank');
};
