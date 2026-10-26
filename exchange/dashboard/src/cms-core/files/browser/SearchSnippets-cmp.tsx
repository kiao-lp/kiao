import React from 'react';
import { theme } from 'antd';
import { SearchMatch } from 'src/cms-core/files/service';

/** How many matched lines a result shows before it stops; the count tag reports the real total. */
const MAX_SNIPPETS = 3;

/**
 * Renders one matched line with the query's hits marked.
 *
 * The ranges come from worker, which already counted them in UTF-16 code units — the same
 * unit String.slice indexes in — so they can be used as-is. Highlighting client-side instead would
 * mean owning a second copy of the query grammar in TypeScript.
 */
export const HighlightedLine: React.FC<{ content: string; ranges?: [number, number][] }> = ({ content, ranges }) => {
    const { token } = theme.useToken();
    if (!ranges?.length) return <>{content}</>;

    const parts: React.ReactNode[] = [];
    let at = 0;
    ranges.forEach(([start, end], i) => {
        if (start > at) parts.push(content.slice(at, start));
        parts.push(
            <mark key={i} style={{ backgroundColor: token.colorWarningBg, color: 'inherit', padding: 0 }}>
                {content.slice(start, end)}
            </mark>,
        );
        at = end;
    });
    if (at < content.length) parts.push(content.slice(at));
    return <>{parts}</>;
};

/** The matched lines under a search hit. Renders nothing for a file matched on its name alone. */
export const SearchSnippets: React.FC<{ matches: SearchMatch[] }> = ({ matches }) => {
    const { token } = theme.useToken();
    if (!matches.length) return null;

    return (
        <div style={{ fontSize: '0.8em', color: token.colorTextDescription, marginTop: 2 }}>
            {matches.slice(0, MAX_SNIPPETS).map(m => (
                <div key={m.line} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ opacity: 0.6, marginRight: 6 }}>{m.line}</span>
                    <HighlightedLine content={m.content} ranges={m.ranges} />
                </div>
            ))}
        </div>
    );
};

/** Shown when the server stopped walking at its result cap, so the list is not the whole truth. */
export const SearchTruncatedNotice: React.FC<{ shown: number }> = ({ shown }) => {
    const { token } = theme.useToken();
    return (
        <div
            data-testid="search-truncated-notice"
            style={{ fontSize: '0.85em', color: token.colorWarning, padding: '4px 8px' }}
        >
            Showing the first {shown} files — refine your search.
        </div>
    );
};
