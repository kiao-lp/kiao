import React, { useMemo } from 'react';

export interface SvgRendererProps {
    children: string;
    className?: string;
    style?: React.CSSProperties;
}

export const SvgRenderer: React.FC<SvgRendererProps> = ({ children, className, style }) => {
    const svgContent = useMemo(() => {
        const trimmed = children.trim();
        if (trimmed.toLowerCase().includes('<svg')) {
            return trimmed;
        }
        return null;
    }, [children]);

    if (!svgContent) {
        return <pre className={className}>{children}</pre>;
    }

    return (
        <div
            className={`svg-renderer-container ${className || ''}`}
            style={{ maxWidth: '100%', ...style }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
        />
    );
};
