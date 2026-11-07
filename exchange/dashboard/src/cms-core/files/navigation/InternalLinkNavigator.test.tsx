import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InternalLinkNavigator } from './InternalLinkNavigator';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));

const ORIGIN = window.location.origin;

/**
 * Clicks an anchor and reports whether the navigator prevented default.
 * The probe cancels the event to stop jsdom navigation.
 */
const clickAnchor = (attributes: Record<string, string>, init: MouseEventInit = {}) => {
    const { container } = render(
        <MemoryRouter>
            <InternalLinkNavigator />
            <a {...attributes}>link</a>
        </MemoryRouter>,
    );
    let taken = false;
    const probe = (e: Event) => { taken = e.defaultPrevented; e.preventDefault(); };
    document.addEventListener('click', probe);
    try {
        container.querySelector('a')!.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
    } finally {
        document.removeEventListener('click', probe);
    }
    return taken;
};

describe('InternalLinkNavigator', () => {
    beforeEach(() => {
        navigate.mockClear();
        vi.stubEnv('BASE_URL', '/dashboard/');
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('navigates in place for a resolved internal link', () => {
        expect(clickAnchor({ href: '/dashboard/units/abc/cadre.md' })).toBe(true);
        expect(navigate).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    it('keeps the query and the fragment', () => {
        clickAnchor({ href: `${ORIGIN}/dashboard/units/abc.mlunit.json?title=T#h` });
        expect(navigate).toHaveBeenCalledWith('/units/abc.mlunit.json?title=T#h');
    });

    // Passage fragments must survive navigation for `useTextFragment` scrolling.
    it('keeps the passage a stored link names', () => {
        clickAnchor({ href: '/dashboard/units/abc/cadre.md#text=is%20drawn%20once' });
        expect(navigate).toHaveBeenCalledWith('/units/abc/cadre.md#text=is%20drawn%20once');
    });

    it('leaves an external link to the browser', () => {
        expect(clickAnchor({ href: 'https://ailleurs.fr/x' })).toBe(false);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('leaves this origin alone outside the app', () => {
        clickAnchor({ href: `${ORIGIN}/api/files/getFile?path=x` });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('leaves an in-page anchor alone', () => {
        expect(clickAnchor({ href: '#section' })).toBe(false);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('leaves a link the user asked to open elsewhere alone', () => {
        clickAnchor({ href: '/dashboard/a.md', target: '_blank' });
        clickAnchor({ href: '/dashboard/a.md', download: '' });
        expect(navigate).not.toHaveBeenCalled();
    });

    it.each([
        ['ctrlKey', { ctrlKey: true }],
        ['metaKey', { metaKey: true }],
        ['shiftKey', { shiftKey: true }],
        ['middle button', { button: 1 }],
    ])('leaves a modified click alone (%s)', (_label, init) => {
        clickAnchor({ href: '/dashboard/a.md' }, init);
        expect(navigate).not.toHaveBeenCalled();
    });

    // Already-handled clicks must not trigger navigation again.
    it('stands down when the click is already handled', () => {
        const { container } = render(
            <MemoryRouter>
                <InternalLinkNavigator />
                <a href="/dashboard/a.md" onClick={(e) => e.preventDefault()}>link</a>
            </MemoryRouter>,
        );
        container.querySelector('a')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

        expect(navigate).not.toHaveBeenCalled();
    });
});
