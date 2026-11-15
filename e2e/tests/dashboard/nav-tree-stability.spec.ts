import { test, expect, Page, workerApi, resetViewState } from '../harness';

/**
 * E2E: the navigation tree holds still, and moves when it is asked to.
 *
 * Four promises, all of them layout, which is why they are asserted against the real app:
 *
 *  - A fresh load reads the store one branch at a time, and the open document may be deep in
 *    it: the pane must end up showing it, however many listings land above its row on the way,
 *    and showing it in the middle rather than against the edge its row came in by.
 *  - Opening a document of another type takes the pane down and mounts a new one — every
 *    plugin main view brings its own `<LayoutContent>`. The tree it draws must be the same
 *    tree, at the same offset, and must never be seen collapsing back to its root.
 *  - Opening a branch is browsing: it changes the shape of the tree and must scroll nothing.
 *  - The crosshair in the pane's header is the way back: it shows the open document again
 *    however far the pane has been taken from it, and reopens the branch holding it.
 *
 * The pane is deliberately measured while the navigation is happening, not only once it has
 * settled: what makes a place in the tree impossible to keep track of is the frames in
 * between.
 */

const TIMEOUT = 15000;
const STATE_DOC = 'dashboard-view-state.json';

/** Short enough that the tree overflows the pane, so there is an offset to hold. */
const VIEWPORT = { width: 1200, height: 420 };

const TREE = '[data-testid="nav-tree"]';

/**
 * The navigation down the left column, and a tree open wide enough to scroll, seeded straight into
 * the view state document rather than clicked: what is under test is what the pane does afterwards.
 */
const seedState = async (expanded: string[]) => {
    const response = await fetch(`${workerApi()}/config/${STATE_DOC}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            global: {
                // Unarranged documents inherit this tree placement.
                toolBars: { placement: { 'file-navigation-tree': 'left' }, off: ['right'], width: { left: 260 } },
                navTree: { expanded },
            },
            folders: {},
            files: {},
        }),
    });
    expect(response.ok).toBeTruthy();
};

const open = async (page: Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator(TREE)).toBeVisible({ timeout: TIMEOUT });
};

const rowCount = (page: Page) => page.locator(`${TREE} > *`).count();

/** Waits for the tree to have stopped growing: a branch lands one listing at a time. */
const settled = async (page: Page) => {
    let last = -1;
    await expect.poll(async () => {
        const count = await rowCount(page);
        const stable = count === last;
        last = count;
        return stable && count > 1;
    }, { timeout: TIMEOUT }).toBe(true);
};

/**
 * Puts a row in the middle of the pane and answers with the offset that took — an offset no
 * pane that starts at the top, or is rebuilt from its root, can be at by accident.
 */
const centreRow = (page: Page, path: string): Promise<number> => page.evaluate(({ tree, path }) => {
    const row = document.querySelector(`[data-testid="nav-item-${path}"]`)!.closest('.cms-nav-tree-row')!;
    const scroller = document.querySelector(tree)!.parentElement as HTMLElement;
    const paneBox = scroller.getBoundingClientRect();
    // Measured rather than computed from offsetTop, whose reference is the positioned
    // ancestor the whole app sits in, not the pane.
    scroller.scrollTop += row.getBoundingClientRect().top - (paneBox.top + scroller.clientHeight / 2);
    return scroller.scrollTop;
}, { tree: TREE, path });

const paneOffset = (page: Page): Promise<number> => page.evaluate(
    tree => (document.querySelector(tree)!.parentElement as HTMLElement).scrollTop, TREE);

/** How far the row of the open document sits from the middle of the pane, in pixels. */
const currentRowOffCentre = (page: Page): Promise<number> => page.evaluate(tree => {
    const row = document.querySelector('[data-current-row]');
    if (!row) return Number.MAX_SAFE_INTEGER;
    const scroller = document.querySelector(tree)!.parentElement as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    const paneBox = scroller.getBoundingClientRect();
    return Math.abs((rowBox.top + rowBox.bottom) / 2 - (paneBox.top + paneBox.bottom) / 2);
}, TREE);

/** Whether the row of the open document is inside the visible band of the pane. */
const currentRowInView = (page: Page): Promise<boolean> => page.evaluate(tree => {
    const row = document.querySelector('[data-current-row]');
    if (!row) return false;
    const scroller = document.querySelector(tree)!.parentElement as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    const paneBox = scroller.getBoundingClientRect();
    return rowBox.bottom > paneBox.top && rowBox.top < paneBox.bottom;
}, TREE);

/** The same, for any row of the tree: a document shown on request is not the open one. */
const rowInView = (page: Page, path: string): Promise<boolean> => page.evaluate(({ tree, path }) => {
    const row = document.querySelector(`[data-row-path="${path}"]`);
    if (!row) return false;
    const scroller = document.querySelector(tree)!.parentElement as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    const paneBox = scroller.getBoundingClientRect();
    return rowBox.bottom > paneBox.top && rowBox.top < paneBox.bottom;
}, { tree: TREE, path });

interface Watch {
    /** The pane's offset on every painted frame. */
    offsets: number[];
    /** The number of rows after every change to the document, painted or not. */
    shapes: number[];
    /** False once the pane's DOM node has been replaced — the remount under test. */
    samePane: boolean;
}

/**
 * Watches the pane from here to `stopWatching`: its offset every frame, its shape on every
 * mutation, and whether it is still the same element. The offsets are what the eye sees;
 * the shapes catch a tree that collapses and grows back between two paints.
 */
const startWatching = (page: Page) => page.evaluate(tree => {
    const w = window as any;
    const scroller = () => document.querySelector(tree)?.parentElement as HTMLElement | null;
    w.__watch = { offsets: [] as number[], shapes: [] as number[] };
    (scroller() as any).__watched = true;

    const sampleShape = () => {
        const rows = document.querySelector(tree)?.children.length ?? 0;
        const shapes = w.__watch.shapes;
        if (shapes[shapes.length - 1] !== rows) shapes.push(rows);
    };
    sampleShape();
    w.__watchObserver = new MutationObserver(sampleShape);
    w.__watchObserver.observe(document.body, { childList: true, subtree: true });

    const tick = () => {
        w.__watch.offsets.push(scroller()?.scrollTop ?? -1);
        w.__watchFrame = requestAnimationFrame(tick);
    };
    tick();
}, TREE);

const stopWatching = (page: Page): Promise<Watch> => page.evaluate(tree => {
    const w = window as any;
    cancelAnimationFrame(w.__watchFrame);
    w.__watchObserver.disconnect();
    const scroller = document.querySelector(tree)?.parentElement as any;
    return { ...w.__watch, samePane: !!scroller?.__watched };
}, TREE);

/** Every folder of the store open, so the tree is taller than the pane. */
const ALL_OPEN = [
    '', 'kiao-user-config', 'kiao-user-config/values', 'folder-a', 'index-page', 'search', 'smoke', 'templates',
    'works', 'works/alpha', 'works/beta',
];

test.describe('navigation tree stability', () => {
    // `seedState` writes the app-wide half of the view state, and the left column it opens is
    // one every spec that follows on this Playwright worker would be laid out around. In a hook rather than
    // at the end of each test, so a failure halfway through leaves it no more open than a pass.
    test.afterEach(resetViewState);

    test.use({ viewport: VIEWPORT });

    test('shows the open document once the store has been read', async ({ page }) => {
        await seedState(ALL_OPEN);
        // Near the end of the tree, so a pane still at the top cannot be showing it, and the
        // branches above it are read after the listing that draws its row.
        await open(page, 'works/beta/article.md');
        await settled(page);

        expect(await currentRowInView(page)).toBe(true);
        expect(await paneOffset(page)).toBeGreaterThan(40);
    });

    test('centres the document it lands on rather than pinning it to an edge', async ({ page }) => {
        await seedState(ALL_OPEN);
        // Deep enough in the tree that a pane starting at the top has to move to show it, and
        // with enough tree left below it that the middle of the pane is a place it can be put.
        await open(page, 'smoke/roundtrip.md');
        await settled(page);

        // Within a row of the middle: the pane centres the row itself, not the band it is in.
        await expect.poll(() => currentRowOffCentre(page), { timeout: TIMEOUT }).toBeLessThan(30);
    });

    test('keeps its shape and its offset when a document of another type is opened', async ({ page }) => {
        await seedState(ALL_OPEN);
        await open(page, 'smoke/roundtrip.md');
        await settled(page);

        const shape = await rowCount(page);
        // The row about to be clicked is centred, so the click cannot scroll the pane itself.
        const offset = await centreRow(page, 'smoke/sample.txt');
        expect(offset).toBeGreaterThan(40);

        await startWatching(page);
        // A .txt is another plugin's: the whole main view, pane included, is replaced.
        await page.getByTestId('nav-item-smoke/sample.txt').click();
        await expect(page.getByTestId('nav-item-smoke/sample.txt').locator('..'))
            .toHaveAttribute('data-current-row', 'true', { timeout: TIMEOUT });
        await settled(page);
        const watch = await stopWatching(page);

        // The premise: this navigation really did replace the pane.
        expect(watch.samePane).toBe(false);
        // Never seen collapsed to its root, or anything short of the tree that was there.
        expect(Math.min(...watch.shapes)).toBe(shape);
        expect(await rowCount(page)).toBe(shape);
        // Never seen at another offset either — not on one frame.
        expect(Math.max(...watch.offsets.map(seen => Math.abs(seen - offset)))).toBeLessThan(2);
        expect(await paneOffset(page)).toBe(offset);
    });

    test('leaves the pane where it is when a branch is opened', async ({ page }) => {
        // The works branch is closed: it is the one this test opens. The open document is
        // near the top of the tree, well away from that branch.
        await seedState(['', 'kiao-user-config', 'folder-a', 'index-page', 'search', 'smoke', 'templates', 'works']);
        await open(page, 'folder-a/note.md');
        await settled(page);

        const shape = await rowCount(page);
        const offset = await centreRow(page, 'works/alpha');
        expect(offset).toBeGreaterThan(40);
        // The open document is off-screen, so a pane that follows it has to move to show it.
        expect(await currentRowInView(page)).toBe(false);

        await startWatching(page);
        await page.getByTestId('nav-toggle-works/alpha').click();
        await expect(page.getByTestId('nav-item-works/alpha/article.md'))
            .toBeVisible({ timeout: TIMEOUT });
        await settled(page);
        const watch = await stopWatching(page);

        // The branch is drawn — the tree did change shape underneath the pane.
        expect(await rowCount(page)).toBeGreaterThan(shape);
        // And the pane stayed exactly where the hand left it.
        expect(Math.max(...watch.offsets.map(seen => Math.abs(seen - offset)))).toBeLessThan(2);
        expect(await paneOffset(page)).toBe(offset);
    });

    test('goes back to the open document when the crosshair is clicked', async ({ page }) => {
        await seedState(ALL_OPEN);
        await open(page, 'folder-a/note.md');
        await settled(page);

        // The pane is taken well away from the open document, as browsing the tree does.
        const offset = await centreRow(page, 'works/alpha/article.md');
        expect(offset).toBeGreaterThan(40);
        expect(await currentRowInView(page)).toBe(false);

        await page.getByTestId('nav-locate-current').click();

        await expect.poll(() => currentRowInView(page), { timeout: TIMEOUT }).toBe(true);
        expect(await paneOffset(page)).not.toBe(offset);
    });

    /**
     * The other crosshair: the one beside a link in a rendered document, which places what the link
     * points at *without following it*. The pane is asked by something that is not the pane — a
     * page being read — which is the whole of what this one is about.
     */
    test('shows a document a link points at, and leaves the reader where they are', async ({ page }) => {
        await seedState(ALL_OPEN);
        // Its body links to a document at the far end of the tree; the pane, showing this one,
        // cannot be showing that one as well.
        await open(page, 'folder-a/note.md');
        await settled(page);

        const linked = 'works/beta/article.md';
        expect(await rowInView(page, linked)).toBe(false);

        // The one internal link the document holds; the crosshair sits beside it.
        await page.getByRole('button', { name: 'Show the document in the file navigator' }).click();

        await expect.poll(() => rowInView(page, linked), { timeout: TIMEOUT }).toBe(true);
        // Following the link is what the link itself is for: the crosshair opened nothing.
        expect(page.url()).toContain('folder-a/note.md');
        await expect(page.locator('[data-current-row]'))
            .toHaveAttribute('data-row-path', 'folder-a/note.md');
    });

    test('opens the branch the open document was closed into', async ({ page }) => {
        await seedState(ALL_OPEN);
        await open(page, 'folder-a/note.md');
        await settled(page);

        // Closed by hand: the open document has no row left in the tree at all.
        await page.getByTestId('nav-toggle-folder-a').click();
        await expect(page.getByTestId('nav-item-folder-a/note.md')).toHaveCount(0);
        await centreRow(page, 'works/alpha/article.md');

        await page.getByTestId('nav-locate-current').click();

        await expect(page.getByTestId('nav-item-folder-a/note.md')).toBeVisible({ timeout: TIMEOUT });
        await expect.poll(() => currentRowInView(page), { timeout: TIMEOUT }).toBe(true);
    });
});
