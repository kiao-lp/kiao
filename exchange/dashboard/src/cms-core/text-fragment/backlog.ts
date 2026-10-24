/**
 * The backlog a markdown document keeps beside itself: one comment per passage worth keeping.
 *
 * A backlog is the `.blog.md` companion of its document — `units/abc/cadre.md` keeps
 * `units/abc/cadre.md.blog.md` — hidden from the listing and travelling with it on rename,
 * copy and delete (see `subsidiary.go` in worker, which owns the suffix list). What is
 * written here is a section per passage: a timestamped heading, a markdown link back to the
 * words, and the blank lines the comment itself is typed on.
 *
 * The link is a passage link in its stored form — bare internal path, `#text=` fragment, no
 * domain and no mount point — so the backlog stays portable the way every other document is.
 * The tab the backlog opens in scrolls to the new heading through that same fragment mechanism
 * (see `useTextFragment`), and puts the caret after the link through `?cursor=end` (see
 * `useCursorFromQuery` in the markdown editor kit).
 */

import { WorkerClient, WorkerError } from 'kiao-worker';
import { resolveInternalLink, storedLinkOf } from '../lib/internal-links';
import { linkToPassage, textFragmentOf, TextDirective } from './textDirective';

/** The companion suffix worker recognises as a backlog. */
export const BACKLOG_SUFFIX = '.blog.md';

/** `units/abc/cadre.md` -> `units/abc/cadre.md.blog.md`. */
export const backlogPathFor = (sourcePath: string): string => `${sourcePath}${BACKLOG_SUFFIX}`;

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncate = (text: string, max: number): string =>
    text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** `]` would end the link text where it stands; `\` is the escape that keeps it literal. */
const escapeLinkText = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Local time, sortable and readable in a heading: `2026-09-22 08:47`. */
export const formatBacklogTimestamp = (date: Date): string =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

export interface BacklogSection {
    /** The heading without its `##` — also what the new tab scrolls to. */
    heading: string;
    /** The whole section: heading, link back, and the blank lines for the comment. */
    markdown: string;
}

/**
 * The section appended for one passage: a timestamped heading carrying the first words, and a
 * markdown link quoting them back to the document they were read in.
 */
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

/**
 * The passage link in its stored form — bare internal path, `#text=` fragment, no domain and no
 * mount point. What a document keeps, whether in a backlog section or pasted into a mindmap note.
 */
export const storedPassageLink = (sourcePath: string, directive: TextDirective): string =>
    linkToPassage(storedLinkOf(sourcePath), [directive]);

/**
 * The passage as a markdown link in that stored form: `[words](/path#text=…)`. The label quotes
 * the selection as it reads on screen — one line, brackets escaped — the way the backlog writes
 * it, but untruncated: what was selected is what is pasted.
 */
export const markdownLinkToPassage = (
    sourcePath: string,
    directive: TextDirective,
    passageText: string,
): string =>
    `[${escapeLinkText(collapseWhitespace(passageText))}](${storedPassageLink(sourcePath, directive)})`;

/** `existing` with `section` after it, separated by exactly one blank line. */
export const appendBacklogSection = (existing: string, section: string): string => {
    if (existing.trim() === '') return section;
    const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return existing + separator + section;
};

/**
 * Where the new tab opens: the backlog, asked to put the caret at its end — after the link just
 * written — and carrying the new heading as a text fragment, which is what scrolls the preview
 * to it. Query before fragment, as a URL is written.
 */
export const backlogUrlFor = (backlogPath: string, heading: string): string =>
    resolveInternalLink(`${storedLinkOf(backlogPath)}?cursor=end${textFragmentOf([{ start: heading }])}`);

/**
 * Appends the passage to its document's backlog, creating the file when there is none yet, and
 * opens the backlog on the new section in a new tab.
 *
 * A missing backlog reads as empty: anything else — a 500, a network failure — propagates, since
 * writing on it would overwrite the very backlog the reader asked to add to.
 */
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
