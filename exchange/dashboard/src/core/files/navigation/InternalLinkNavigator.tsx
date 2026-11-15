import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { internalPathOf } from '../../navigation/internal-links';

/** Converts clicks on internal plain anchors to router navigation, avoiding full page loads. Bubble-phase listener; skips clicks already handled. */
export const InternalLinkNavigator: React.FC = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            // Modified clicks are the user asking the browser for a tab, a window or a download.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const anchor = (e.target as Element | null)?.closest?.('a');
            if (!anchor) return;
            // Use attributes: SVG `<a>` exposes `href`/`target` as SVGAnimatedString, not strings.
            if (anchor.getAttribute('target') || anchor.hasAttribute('download')) return;

            const href = anchor.getAttribute('href');
            if (!href) return;

            const path = internalPathOf(href);
            if (path === null) return;

            e.preventDefault();
            navigate(path);
        };

        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, [navigate]);

    return null;
};
