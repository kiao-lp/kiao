import React, { useCallback, useState } from 'react';
import { setClipboardHtml } from '../../lib/clipboard';
import { SOURCE_LINE_ATTRIBUTE } from '../../lib/rehypeSourceLine';
import { Tooltip } from '../../../ui/Tooltip';

/**
 * The copied HTML is for other documents — an email, a page — so what belongs to the reader's
 * screen has no place in it: the anchors an editor aligns its source with, and every button the
 * render put there. A button is something to press, and there is nothing to press in a mail: the
 * copy on a code block, the crosshair beside a link. `printMarkdownToPdf` drops the same
 * two, for the same reason.
 */
const forOtherDocuments = (container: HTMLElement): string => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll(`[${SOURCE_LINE_ATTRIBUTE}]`)) {
        element.removeAttribute(SOURCE_LINE_ATTRIBUTE);
    }
    clone.querySelectorAll('button').forEach(button => button.remove());
    return clone.innerHTML;
};

export const CopyHtmlButton: React.FC<{ containerRef: React.RefObject<HTMLDivElement | null> }> = ({ containerRef }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!containerRef.current) return;
        const html = forOtherDocuments(containerRef.current);
        await setClipboardHtml(html);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [containerRef]);

    return (
        <Tooltip title={copied ? 'Copié !' : 'Copier en HTML (pour Outlook)'}>
            <button
                type="button"
                onClick={handleCopy}
                className="copy-html-btn icon-only"
                aria-label={copied ? 'Copié !' : 'Copier en HTML'}
            >
                {copied ? '✓' : '⎘'}
            </button>
        </Tooltip>
    );
};
