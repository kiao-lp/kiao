import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { internalPathOf } from '../../lib/internal-links';

/**
 * Turns a click on any anchor pointing inside the app into a router navigation.
 *
 * A stored link is rendered as a plain `<a href="/dashboard/…">` — by the markdown renderer, by the
 * regex converter that builds the diagram tooltips, by a plugin writing an anchor by hand — and a
 * plain anchor is a full page load: the whole app is torn down and rebuilt to show a file the
 * router could have opened in place. One listener here covers every one of those, present and
 * future, instead of each renderer having to reach for `<Link>`.
 *
 * It listens in the bubble phase and stands down on `defaultPrevented`, so anything that already
 * handles its own click — a react-router `<Link>`, a plugin's `onClick` — keeps it.
 */
export const InternalLinkNavigator: React.FC = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            // Modified clicks are the user asking the browser for a tab, a window or a download.
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const anchor = (e.target as Element | null)?.closest?.('a');
            if (!anchor) return;
            // Read attributes rather than properties: an SVG <a>, which a diagram tooltip may hold,
            // exposes `href` and `target` as SVGAnimatedString rather than as strings.
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
