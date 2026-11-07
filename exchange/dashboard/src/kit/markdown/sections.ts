/** A file as a flat list of sections at one heading rank. Text inside a section survives a round trip byte for byte; a `#` line in a fence is code. */

/** Ranges of fenced code blocks. */
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

export interface SectionedText {
    preamble: string;
    /** Heading line included, no trailing blank lines. */
    sections: string[];
}

export const splitSections = (text: string, rank: number): SectionedText => {
    const offsets = headingOffsets(text, rank);
    if (offsets.length === 0) return { preamble: text.replace(/\s+$/, ''), sections: [] };

    return {
        preamble: text.slice(0, offsets[0]).replace(/\s+$/, ''),
        sections: offsets.map((start, i) => text.slice(start, offsets[i + 1] ?? text.length).replace(/\s+$/, '')),
    };
};

/** The single write path: preamble, then sections one blank line apart. */
export const joinSections = (preamble: string, sections: string[]): string => {
    const parts = [preamble, ...sections]
        .map(part => part.replace(/^\s+|\s+$/g, ''))
        .filter(part => part !== '');
    return parts.length === 0 ? '' : parts.join('\n\n') + '\n';
};

/** `''` for a section without a heading. */
export const headingTextOf = (section: string, rank: number): string =>
    (section.match(new RegExp(`^#{${rank}}[ \\t]+(.*)$`, 'm'))?.[1] ?? '').trim();

/** A heading that would split its section. */
export interface StrayHeading {
    at: number;
    /** `#` to insert to demote the line below the section rank. */
    fill: string;
}

/** Headings at or above `rank` after the section's own heading, in file order. Deeper headings are not reported. */
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

/** Demotes stray headings to `rank + 1`. The section heading and deeper headings are untouched. */
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

/** Shifts all headings by one amount so the shallowest is `minRank`, capped at `######`. Headings in fences are untouched. */
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
