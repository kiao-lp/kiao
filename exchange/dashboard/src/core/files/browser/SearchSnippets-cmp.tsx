import React from 'react';
import { HighlightedText } from '../../ui-foundation/text-input/HighlightedText';
import { theme } from 'antd';
import { SearchMatch } from 'src/core/files/service';

// Cap; count tag shows total.
const MAX_SNIPPETS = 3;

export const SearchSnippets: React.FC<{ matches: SearchMatch[] }> = ({ matches }) => {
    const { token } = theme.useToken();
    if (!matches.length) return null;

    return (
        <div style={{ fontSize: '0.8em', color: token.colorTextDescription, marginTop: 2 }}>
            {matches.slice(0, MAX_SNIPPETS).map(m => (
                <div key={m.line} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ opacity: 0.6, marginRight: 6 }}>{m.line}</span>
                    <HighlightedText content={m.content} ranges={m.ranges} />
                </div>
            ))}
        </div>
    );
};

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
