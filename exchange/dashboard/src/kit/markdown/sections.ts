/**
 * A markdown file read as a **flat list of sections at one heading rank**: the bookmarks file,
 * whose bookmarks are its `###` sections, and any other file kept the same way.
 *
 * The rank is all that differs between such files, so it is a parameter here and a constant in
 * each of them. The rest is one rule written once: a section is handled as the *text* between two
 * headings rather than as a parsed tree — moving, editing and splitting one are then the same
 * operation, and whatever sits inside it (sub-headings, tables, code blocks) survives a round trip
 * byte for byte — and a heading at or above that rank is what would end the section it is written
 * in, so text put into one is brought down below it.
 *
 * Fence-aware throughout: a `##` inside a code block is code, not a heading.
 */

/** Character ranges covered by fenced code blocks, where a `#` line is code, not a heading. */
export const fenceRanges = (text: string): [number, number][] => {
    const ranges: [number, number][] = [];
    const fence = /^(?: {0,3})(```|~~~).*$/gm;
    let open: number | null = null;
    let match: RegExpExecArray | null;
    while ((match = fence.exec(text)) !== null) {
        if (open === null) open = match.index;
        else {
            ranges.push([open, match.index + match[0].length]);
            open = null;
        }
    }
    // An unclosed fence runs to the end of the file, as a markdown renderer would read it.
    if (open !== null) ranges.push([open, text.length]);
    return ranges;
};

export const isInsideFence = (index: number, ranges: [number, number][]): boolean =>
    ranges.some(([start, end]) => index >= start && index < end);

/** Start offset of every heading of that rank, in file order. */
export const headingOffsets = (text: string, rank: number): number[] => {
    const ranges = fenceRanges(text);
    const heading = new RegExp(`^#{${rank}}[ \\t]+.*$`, 'gm');
    const offsets: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = heading.exec(text)) !== null) {
        if (!isInsideFence(match.index, ranges)) offsets.push(match.index);
    }
    return offsets;
};

/** What a file at that rank is: whatever precedes the first heading, then one string per section. */
export interface SectionedText {
    /** Everything before the first section, kept as it was written. */
    preamble: string;
    /** Each section, its heading line included, without its trailing blank lines. */
    sections: string[];
}

/** Reads a file into its preamble and its sections. */
export const splitSections = (text: string, rank: number): SectionedText => {
    const offsets = headingOffsets(text, rank);
    if (offsets.length === 0) return { preamble: text.replace(/\s+$/, ''), sections: [] };

    return {
        preamble: text.slice(0, offsets[0]).replace(/\s+$/, ''),
        sections: offsets.map((start, i) => text.slice(start, offsets[i + 1] ?? text.length).replace(/\s+$/, '')),
    };
};

/**
 * Writes a file back: the preamble, then the sections, one blank line apart. Every write goes
 * through here, so nothing ever invents a second way of spacing a file.
 */
export const joinSections = (preamble: string, sections: string[]): string => {
    const parts = [preamble, ...sections]
        .map(part => part.replace(/^\s+|\s+$/g, ''))
        .filter(part => part !== '');
    return parts.length === 0 ? '' : parts.join('\n\n') + '\n';
};

/** What a section's own heading line says. `''` for a section written without one. */
export const headingTextOf = (section: string, rank: number): string =>
    (section.match(new RegExp(`^#{${rank}}[ \\t]+(.*)$`, 'm'))?.[1] ?? '').trim();

/** A heading of a section that would break the section apart, and what stops it from being one. */
export interface StrayHeading {
    /** Offset of the line's first `#`. */
    at: number;
    /** The `#` that go in there to bring the line down below the section's own rank. */
    fill: string;
}

/**
 * The headings a section's text carries that its file cannot hold, in file order.
 *
 * A section *is* a heading and what follows it: the `### ` a bookmark opens on is what makes it
 * one, and a second `### ` further down is what would end it. What follows that one becomes a
 * section of its own, while the panel goes on editing under the rank it was given — so the next
 * keystroke files the whole text it holds under a section that is now only the half above, and the
 * half below stays where it was split off. Keep typing and the tail is copied down the file once
 * per keystroke. A shallower heading is no better: a `#` inside a level-2 section closes it for
 * anything reading the file as markdown rather than by rank.
 *
 * The first one found is the section's own and is left where it is, wherever it sits — a section is
 * written heading first, but a caret at the top of one is free to push it down a line before
 * typing. Anything deeper than its rank is a sub-heading, which a section is welcome to, and is not
 * reported.
 */
export const strayHeadings = (section: string, rank: number): StrayHeading[] => {
    const ranges = fenceRanges(section);
    const heading = new RegExp(`^(#{1,${rank}})[ \\t]`, 'gm');
    const strays: StrayHeading[] = [];
    let own = false;
    let match: RegExpExecArray | null;
    while ((match = heading.exec(section)) !== null) {
        if (isInsideFence(match.index, ranges)) continue;
        if (!own) own = true;
        else strays.push({ at: match.index, fill: '#'.repeat(rank + 1 - match[1].length) });
    }
    return strays;
};

/**
 * A section's text with its stray headings pushed under it — the shape it has to have for its file
 * to still hold one section where it held one.
 *
 * A demotion rather than a refusal: a line opened with `#` was meant to be a heading, and the
 * shallowest one a section has room for is the rank under its own. The heading the section *is*,
 * and everything already deep enough under it, come back untouched.
 */
export const demoteStrayHeadings = (section: string, rank: number): string => {
    const strays = strayHeadings(section, rank);
    if (strays.length === 0) return section;

    let text = '';
    let from = 0;
    for (const { at, fill } of strays) {
        text += section.slice(from, at) + fill;
        from = at;
    }
    return text + section.slice(from);
};

/**
 * Foreign markdown — an answer, a note — made safe to sit inside a section. Every heading is pushed
 * down until the shallowest of them is `minRank`: a heading above that in what is added to a
 * section would split it into sections of its own.
 *
 * The whole set moves by the same amount rather than being clamped one by one, so what the text
 * said about its own structure it still says; nothing goes past `######`, markdown having no
 * seventh level.
 */
export const demoteHeadings = (text: string, minRank: number): string => {
    const ranges = fenceRanges(text);
    const heading = /^(#{1,6})([ \t]+)/gm;
    const levels: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = heading.exec(text)) !== null) {
        if (!isInsideFence(match.index, ranges)) levels.push(match[1].length);
    }
    if (levels.length === 0) return text;

    const shift = minRank - Math.min(...levels);
    if (shift <= 0) return text;
    return text.replace(heading, (whole, hashes: string, spacing: string, offset: number) => (
        isInsideFence(offset, ranges)
            ? whole
            : '#'.repeat(Math.min(6, hashes.length + shift)) + spacing
    ));
};
