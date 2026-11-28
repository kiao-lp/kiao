import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    encodedDcmsLinkOf, internalPathOf, normalizeDocumentLink, resolveInternalLink,
    storedLinkOf, storePathOfHref, toStoredLink,
} from './internal-links';

/** jsdom serves the page from this origin, so it is what counts as "internal". */
const ORIGIN = window.location.origin;

describe('internal-links', () => {
    beforeEach(() => { vi.stubEnv('BASE_URL', '/dashboard/'); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('keeps the legacy exports as aliases', () => {
        expect(storedLinkOf).toBe(encodedDcmsLinkOf);
        expect(toStoredLink).toBe(normalizeDocumentLink);
    });

    describe('normalizeDocumentLink', () => {
        it('strips the origin and the context path from a link to this app', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/dashboard/mon/chemin`)).toBe('/mon/chemin');
        });

        it('converts an origin-relative Dashboard href to a DCMS link', () => {
            expect(normalizeDocumentLink('/dashboard/mon/chemin')).toBe('/mon/chemin');
        });

        it('keeps an existing DCMS link', () => {
            expect(normalizeDocumentLink('/mon/chemin')).toBe('/mon/chemin');
        });

        it('keeps the query and the fragment', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/dashboard/a/b.md?title=x#h`)).toBe('/a/b.md?title=x#h');
            expect(normalizeDocumentLink('/dashboard/a/b.md?title=x#h')).toBe('/a/b.md?title=x#h');
        });

        it('keeps percent-encoding, which a markdown destination needs', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/dashboard/mon%20chemin.md`)).toBe('/mon%20chemin.md');
        });

        it('maps the app root to /', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/dashboard/`)).toBe('/');
            expect(normalizeDocumentLink('/dashboard')).toBe('/');
        });

        it('leaves another origin alone, context path or not', () => {
            expect(normalizeDocumentLink('https://example.com/dashboard/a/b.md'))
                .toBe('https://example.com/dashboard/a/b.md');
            expect(normalizeDocumentLink('https://ailleurs.fr/x')).toBe('https://ailleurs.fr/x');
        });

        it('leaves this origin alone outside the app', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/api/files/getFile?path=x`))
                .toBe(`${ORIGIN}/api/files/getFile?path=x`);
        });

        it('preserves fragments, document-relative links, external links and custom schemes', () => {
            for (const link of ['', '#ancre', '//host/a', './rel.md', '../up.md', 'rel.md',
                'unit::/units/abc/abc.mlunit.json', 'template::x/y.temp.md', 'mailto:a@b.fr', 'data:image/png;base64,AA']) {
                expect(normalizeDocumentLink(link)).toBe(link);
            }
        });
    });

    describe('resolveInternalLink', () => {
        it('adds the Dashboard mount point to a DCMS link', () => {
            expect(resolveInternalLink('/mon/chemin')).toBe('/dashboard/mon/chemin');
            expect(resolveInternalLink('/a/b.md?title=x#h')).toBe('/dashboard/a/b.md?title=x#h');
        });

        it('is idempotent, so content written before the change keeps working', () => {
            expect(resolveInternalLink('/dashboard/mon/chemin')).toBe('/dashboard/mon/chemin');
            expect(resolveInternalLink('/dashboard')).toBe('/dashboard');
        });

        it('preserves fragments, document-relative links, external links and custom schemes', () => {
            for (const link of ['', '#ancre', '//host/a', './rel.md', 'rel.md', 'unit::/units/abc/abc.mlunit.json',
                'https://ailleurs.fr/x', 'mailto:a@b.fr']) {
                expect(resolveInternalLink(link)).toBe(link);
            }
        });

        it('round-trips with normalizeDocumentLink', () => {
            const shown = `${ORIGIN}/dashboard/units/abc/cadre.md`;
            expect(`${ORIGIN}${resolveInternalLink(normalizeDocumentLink(shown))}`).toBe(shown);
        });
    });

    describe('internalPathOf', () => {
        it('answers the app path for a link to this app', () => {
            expect(internalPathOf(`${ORIGIN}/dashboard/a/b.md`)).toBe('/a/b.md');
            expect(internalPathOf(`${ORIGIN}/dashboard/`)).toBe('/');
        });

        it('resolves a relative href against the current page', () => {
            expect(internalPathOf('/dashboard/a/b.md')).toBe('/a/b.md');
        });

        it('answers null outside the app', () => {
            expect(internalPathOf('https://ailleurs.fr/dashboard/a/b.md')).toBeNull();
            expect(internalPathOf(`${ORIGIN}/plantuml/x`)).toBeNull();
            expect(internalPathOf('mailto:a@b.fr')).toBeNull();
            expect(internalPathOf('unit::/units/abc/abc.mlunit.json')).toBeNull();
            expect(internalPathOf(`blob:${ORIGIN}/1234`)).toBeNull();
            expect(internalPathOf('#ancre')).toBeNull();
        });
    });

    // storePathOfHref returns the path the navigation tree keys on.
    describe('storePathOfHref', () => {
        it('answers the store path a link points at', () => {
            expect(storePathOfHref('/dashboard/units/abc/cadre.md')).toBe('units/abc/cadre.md');
            expect(storePathOfHref(`${ORIGIN}/dashboard/units/abc/cadre.md`)).toBe('units/abc/cadre.md');
        });

        it('answers the DCMS root as the empty path, which is what the tree calls it', () => {
            expect(storePathOfHref('/dashboard/')).toBe('');
        });

        it('drops the query and the fragment, which name a place in the document', () => {
            expect(storePathOfHref('/dashboard/a/b.md?title=x#text=un%20passage')).toBe('a/b.md');
        });

        it('undoes the escapes a name with a space is written with', () => {
            expect(storePathOfHref('/dashboard/mon%20dossier/mon%20fichier.md')).toBe('mon dossier/mon fichier.md');
        });

        // Malformed escapes stay literal.
        it('keeps a path whose escapes are not escapes', () => {
            expect(storePathOfHref('/dashboard/100%.md')).toBe('100%.md');
        });

        it('answers null for a link that names no document of the store', () => {
            expect(storePathOfHref('https://ailleurs.fr/a/b.md')).toBeNull();
            expect(storePathOfHref('#ancre')).toBeNull();
            expect(storePathOfHref('unit::/units/abc/abc.mlunit.json')).toBeNull();
        });
    });

    describe('mounted at the root', () => {
        beforeEach(() => { vi.stubEnv('BASE_URL', '/'); });

        it('uses the DCMS link as the displayed href', () => {
            expect(normalizeDocumentLink(`${ORIGIN}/mon/chemin`)).toBe('/mon/chemin');
            expect(resolveInternalLink('/mon/chemin')).toBe('/mon/chemin');
            expect(internalPathOf(`${ORIGIN}/mon/chemin`)).toBe('/mon/chemin');
        });
    });

    describe('mounted elsewhere', () => {
        beforeEach(() => { vi.stubEnv('BASE_URL', '/cms/'); });

        it('resolves content written for another mount point onto the new one', () => {
            expect(resolveInternalLink('/mon/chemin')).toBe('/cms/mon/chemin');
            expect(normalizeDocumentLink(`${ORIGIN}/cms/mon/chemin`)).toBe('/mon/chemin');
        });
    });
});
