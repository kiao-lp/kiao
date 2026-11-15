import React from 'react';
import { theme } from 'antd';

/** Ranges use UTF-16 offsets, as string slices do. */
export const HighlightedText: React.FC<{ content: string; ranges?: [number, number][] }> = ({ content, ranges }) => {
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
