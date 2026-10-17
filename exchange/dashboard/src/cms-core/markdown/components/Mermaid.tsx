import React, { useContext, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import {
    configureMermaid, renderMermaidDiagram, readMermaidFailure, type MermaidFailure,
} from '../lib/mermaid';
import { DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext, type Theme } from '../../../ThemeContext';

export interface MermaidProps {
    children: React.ReactNode;
    theme?: Theme;
    onSvg?: (svg: string) => void;
}

export const Mermaid: React.FC<MermaidProps> = ({ children, theme, onSvg }) => {
    const ref = useRef<HTMLDivElement>(null);
    const idBase = useRef(nanoid());
    const renderCount = useRef(0);
    const [failure, setFailure] = useState<MermaidFailure | null>(null);
    const appTheme = useContext(ThemeContext)?.theme ?? DEFAULT_KIAO_THEME;
    const resolvedTheme = theme ?? appTheme;

    useEffect(() => {
        if (!ref.current || !children || typeof children !== 'string') return;
        configureMermaid(resolvedTheme);
        renderCount.current += 1;
        const id = `mermaid-${idBase.current}-${renderCount.current}`;
        // A render started for a source that has since been typed over has nothing left to say:
        // it would otherwise be free to land after the newer one and put the older drawing back.
        let current = true;
        renderMermaidDiagram(id, children)
            .then((svg) => {
                if (!current || !ref.current) return;
                ref.current.innerHTML = svg;
                setFailure(null);
                onSvg?.(svg);
            })
            .catch((err) => {
                if (!current) return;
                // The drawing goes with the source it was drawn from. Leaving it would show a
                // diagram that no longer says what the block says.
                if (ref.current) ref.current.innerHTML = '';
                setFailure(readMermaidFailure(err));
            });
        return () => {
            current = false;
        };
    }, [children, resolvedTheme]);

    return (
        <div
            className="mermaid"
            data-mermaid-source={typeof children === 'string' ? children : undefined}
            style={{ maxWidth: '100%', overflowX: 'auto' }}
        >
            <div ref={ref} />
            {failure && (
                <div className="mermaid-error">
                    <strong>
                        {failure.kind === 'diagram' ? 'Mermaid render error' : 'Diagram renderer unavailable'}
                    </strong>
                    {/* Mermaid points at the offending token with a caret on the line below it,
                        which only lands under the token in a monospace font. */}
                    {failure.kind === 'diagram' ? <pre>{failure.message}</pre> : <p>{failure.message}</p>}
                </div>
            )}
        </div>
    );
};
