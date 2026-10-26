import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { internalPathOf, resolveInternalLink, storePathOfHref, toStoredLink } from './internal-links';

/** jsdom serves the page from this origin, so it is what counts as "internal". */
const ORIGIN = window.location.origin;

describe('internal-links', () => {
    beforeEach(() => { vi.stubEnv('BASE_URL', '/dashboard/'); });
    afterEach(() => { vi.unstubAllEnvs(); });

    describe('toStoredLink', () => {
        it('strips the origin and the context path from a link to this app', () => {
            expect(toStoredLink(`${ORIGIN}/dashboard/mon/chemin`)).toBe('/mon/chemin');
        });

        it('strips the context path from a root-relative link', () => {
            expect(toStoredLink('/dashboard/mon/chemin')).toBe('/mon/chemin');
        });

        it('leaves an already-bare link alone', () => {
            expect(toStoredLink('/mon/chemin')).toBe('/mon/chemin');
        });

        it('keeps the query and the fragment', () => {
            expect(toStoredLink(`${ORIGIN}/dashboard/a/b.md?title=x#h`)).toBe('/a/b.md?title=x#h');
            expect(toStoredLink('/dashboard/a/b.md?title=x#h')).toBe('/a/b.md?title=x#h');
        });

        it('keeps percent-encoding, which a markdown destination needs', () => {
            expect(toStoredLink(`${ORIGIN}/dashboard/mon%20chemin.md`)).toBe('/mon%20chemin.md');
        });

        it('maps the app root to /', () => {
            expect(toStoredLink(`${ORIGIN}/dashboard/`)).toBe('/');
            expect(toStoredLink('/dashboard')).toBe('/');
        });

        it('leaves another origin alone, context path or not', () => {
            expect(toStoredLink('https://example.com/dashboard/a/b.md'))
                .toBe('https://example.com/dashboard/a/b.md');
            expect(toStoredLink('https://ailleurs.fr/x')).toBe('https://ailleurs.fr/x');
        });

        it('leaves this origin alone outside the app', () => {
            expect(toStoredLink(`${ORIGIN}/api/files/getFile?path=x`))
                .toBe(`${ORIGIN}/api/files/getFile?path=x`);
        });

        it('leaves everything that is not a path alone', () => {
            for (const link of ['', '#ancre', '//host/a', './rel.md', '../up.md', 'rel.md',
                'unit::/units/abc/abc.mlunit.json', 'template::x/y.temp.md', 'mailto:a@b.fr', 'data:image/png;base64,AA']) {
                expect(toStoredLink(link)).toBe(link);
            }
        });
    });

    describe('resolveInternalLink', () => {
        it('prefixes the context path onto a stored link', () => {
            expect(resolveInternalLink('/mon/chemin')).toBe('/dashboard/mon/chemin');
            expect(resolveInternalLink('/a/b.md?title=x#h')).toBe('/dashboard/a/b.md?title=x#h');
        });

        it('is idempotent, so content written before the change keeps working', () => {
            expect(resolveInternalLink('/dashboard/mon/chemin')).toBe('/dashboard/mon/chemin');
            expect(resolveInternalLink('/dashboard')).toBe('/dashboard');
        });

        it('leaves everything that is not a store path alone', () => {
            for (const link of ['', '#ancre', '//host/a', './rel.md', 'rel.md', 'unit::/units/abc/abc.mlunit.json',
                'https://ailleurs.fr/x', 'mailto:a@b.fr']) {
                expect(resolveInternalLink(link)).toBe(link);
            }
        });

        it('round-trips with toStoredLink', () => {
            const shown = `${ORIGIN}/dashboard/units/abc/cadre.md`;
            expect(`${ORIGIN}${resolveInternalLink(toStoredLink(shown))}`).toBe(shown);
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

    // What a link names to everything that acts on the store rather than opening it — the
    // navigation tree, which knows a row by its path and nothing else.
    describe('storePathOfHref', () => {
        it('answers the store path a link points at', () => {
            expect(storePathOfHref('/dashboard/units/abc/cadre.md')).toBe('units/abc/cadre.md');
            expect(storePathOfHref(`${ORIGIN}/dashboard/units/abc/cadre.md`)).toBe('units/abc/cadre.md');
        });

        it('answers the store root as the empty path, which is what the tree calls it', () => {
            expect(storePathOfHref('/dashboard/')).toBe('');
        });

        it('drops the query and the fragment, which name a place in the document', () => {
            expect(storePathOfHref('/dashboard/a/b.md?title=x#text=un%20passage')).toBe('a/b.md');
        });

        it('undoes the escapes a name with a space is written with', () => {
            expect(storePathOfHref('/dashboard/mon%20dossier/mon%20fichier.md')).toBe('mon dossier/mon fichier.md');
        });

        // A destination typed by hand can hold a % that starts nothing; it still names a file.
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

        it('stores and resolves the same bare path', () => {
            expect(toStoredLink(`${ORIGIN}/mon/chemin`)).toBe('/mon/chemin');
            expect(resolveInternalLink('/mon/chemin')).toBe('/mon/chemin');
            expect(internalPathOf(`${ORIGIN}/mon/chemin`)).toBe('/mon/chemin');
        });
    });

    describe('mounted elsewhere', () => {
        beforeEach(() => { vi.stubEnv('BASE_URL', '/cms/'); });

        it('resolves content written for another mount point onto the new one', () => {
            expect(resolveInternalLink('/mon/chemin')).toBe('/cms/mon/chemin');
            expect(toStoredLink(`${ORIGIN}/cms/mon/chemin`)).toBe('/mon/chemin');
        });
    });
});
