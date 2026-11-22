import React, { useCallback, useState } from 'react';
import { setClipboardHtml } from './svgClipboard';
import './CopyButton.css';

const forOtherDocuments = (container: HTMLElement, omitAttributes: readonly string[]): string => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const attribute of omitAttributes) {
        for (const element of clone.querySelectorAll(`[${attribute}]`)) {
            element.removeAttribute(attribute);
        }
    }
    clone.querySelectorAll('button').forEach(button => button.remove());
    return clone.innerHTML;
};

const NO_ATTRIBUTES: readonly string[] = [];

export const CopyHtmlButton: React.FC<{
    containerRef: React.RefObject<HTMLDivElement | null>;
    omitAttributes?: readonly string[];
    className?: string;
    label?: string;
    copiedLabel?: string;
}> = ({ containerRef, omitAttributes = NO_ATTRIBUTES, className = 'ui-copy-button', label = 'Copy HTML', copiedLabel = 'Copied!' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!containerRef.current) return;
        const html = forOtherDocuments(containerRef.current, omitAttributes);
        await setClipboardHtml(html);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [containerRef, omitAttributes]);

    return (
        <button
            type="button"
            onClick={handleCopy}
            className={className}
            aria-label={copied ? copiedLabel : label}
        >
            {copied ? '✓' : '⎘'}
        </button>
    );
};
