import React, { useCallback, useEffect, useRef, useState } from 'react';
import { setClipboardSvg, setClipboardPng } from '../../lib/clipboard';
import { Tooltip } from '../../../ui/Tooltip';

type Format = 'svg' | 'png';

const FORMATS: { value: Format; label: string }[] = [
    { value: 'svg', label: 'Copy as SVG' },
    { value: 'png', label: 'Copy as PNG' },
];

export const CopySvgButton: React.FC<{ getSvg: () => Promise<string | null> | string | null }> = ({ getSvg }) => {
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const handleCopy = useCallback(async (format: Format) => {
        setOpen(false);
        const svg = await getSvg();
        if (!svg) return;
        try {
            if (format === 'svg') {
                await setClipboardSvg(svg);
            } else {
                await setClipboardPng(svg);
            }
        } catch (e) {
            console.error(`Failed to copy diagram as ${format.toUpperCase()}`, e);
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [getSvg]);

    return (
        <div className="svg-copy-dropdown" ref={wrapperRef}>
            <Tooltip title="Copy image">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="code-copy-btn svg-copy-btn"
                    aria-label="Copy image"
                    aria-haspopup="menu"
                    aria-expanded={open}
                >
                    {copied ? '✓' : 'IMG ▾'}
                </button>
            </Tooltip>
            {open && (
                <div className="svg-copy-menu" role="menu">
                    {FORMATS.map(({ value, label }) => (
                        <button
                            key={value}
                            type="button"
                            role="menuitem"
                            className="svg-copy-menu-item"
                            onClick={() => handleCopy(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
