import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, Locator, Page, restoreFixture, workerApi } from '../../harness';

/**
 * E2E: a map drawn larger than the pane it is drawn in.
 *
 * The map takes the size its notes take, and the pane around it scrolls — the scrolling every
 * other plugin gets from the document area. A map was clipped by its own pane instead, so a map
 * larger than the frame had no scrollbar and, on a touch screen, nothing to pan.
 *
 * It is asserted with a finger as well as a wheel because a pan is the browser's own gesture: it
 * happens only where something actually scrolls.
 */

const TIMEOUT = 15000;
/** Two notes 2360 apart: far enough that the map overflows any pane it is opened in. */
const FILE = 'folder-a/Scroll.mmap.json';
const SIDE_FILE = 'folder-a/note.md.mmap.json';
const HOST = 'folder-a/note.md';

const map = (page: Page) => page.locator('.mindmap');
const farNote = (page: Page) => page.locator('.mindmap-rect', { hasText: 'Far' });

/** The element the map scrolls with: the nearest ancestor with a scrollbar. */
const scrollerOf = (locator: Locator) => locator.evaluate(el => {
    for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (/(auto|scroll)/.test(style.overflowX + style.overflowY)) {
            return { width: p.clientWidth, height: p.clientHeight, scrollWidth: p.scrollWidth, scrollHeight: p.scrollHeight };
        }
    }
    return null;
});

const scrollToEnd = (locator: Locator) => locator.evaluate(el => {
    for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (/(auto|scroll)/.test(style.overflowX + style.overflowY)) {
            p.scrollLeft = p.scrollWidth;
            p.scrollTop = p.scrollHeight;
            return;
        }
    }
});

const scrollPosition = (locator: Locator) => locator.evaluate(el => {
    for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (/(auto|scroll)/.test(style.overflowX + style.overflowY)) {
            return { left: p.scrollLeft, top: p.scrollTop };
        }
    }
    return { left: 0, top: 0 };
});

/** A finger rather than a wheel: `Input.dispatchTouchEvent` reaches the browser's gesture handling,
 *  where a map that clips its own content pans nothing at all. Several moves, as a finger sends. */
const swipe = async (page: Page, from: { x: number, y: number }, to: { x: number, y: number }) => {
    const cdp = await page.context().newCDPSession(page);
    const at = (fraction: number) => [{
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
        id: 1,
    }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (const fraction of [0.25, 0.6, 1]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(fraction) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
};

test.describe('a mindmap larger than its pane', () => {
    test.beforeEach(async ({ request }) => { await restoreFixture(request, FILE); });

    test('scrolls both ways and leaves no note out of reach', async ({ page }) => {
        await page.goto(FILE);
        await expect(map(page)).toBeVisible({ timeout: TIMEOUT });

        const scroller = await scrollerOf(map(page));
        expect(scroller!.scrollWidth).toBeGreaterThan(scroller!.width);
        expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.height);

        await expect(farNote(page)).not.toBeInViewport();
        await scrollToEnd(map(page));
        await expect(farNote(page)).toBeInViewport({ ratio: 1 });
    });
});

test.describe('a mindmap in the secondary document', () => {
    test.beforeEach(async ({ request }) => {
        const wide = readFileSync(resolve(__dirname, '../../../data/files-template', FILE));
        const saved = await request.put(`${workerApi()}/update?path=${encodeURIComponent(SIDE_FILE)}`, {
            multipart: { file: { name: 'note.md.mmap.json', mimeType: 'application/json', buffer: wide } },
        });
        expect(saved.ok(), 'writing the map beside the markdown').toBeTruthy();
    });

    test.afterEach(async ({ request }) => {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(SIDE_FILE)}`).catch(() => undefined);
    });

    test('scrolls in its own pane as in the document tab', async ({ page }) => {
        await page.goto(HOST);
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        const toggle = page.getByRole('button', { name: /(Show|Hide) Mindmap/ });
        if ((await toggle.getAttribute('aria-label')) === 'Show Mindmap') await toggle.click();

        const pane = page.locator('[data-testid="secondary-document-panel"]');
        const secondaryMap = pane.locator('.mindmap');
        await expect(secondaryMap).toBeVisible({ timeout: TIMEOUT });

        const scroller = await scrollerOf(secondaryMap);
        expect(scroller!.scrollWidth).toBeGreaterThan(scroller!.width);
        expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.height);

        await scrollToEnd(secondaryMap);
        await expect(pane.locator('.mindmap-rect', { hasText: 'Far' })).toBeInViewport({ ratio: 1 });
    });
});

test.describe('a finger on a mindmap', () => {
    test.use({ hasTouch: true, viewport: { width: 480, height: 800 } });

    test('pans it in both directions', async ({ page }) => {
        await page.goto(FILE);
        await expect(map(page)).toBeVisible({ timeout: TIMEOUT });

        const before = await scrollPosition(map(page));
        await swipe(page, { x: 420, y: 700 }, { x: 100, y: 250 });
        const after = await scrollPosition(map(page));

        expect(after.left).toBeGreaterThan(before.left + 100);
        expect(after.top).toBeGreaterThan(before.top + 100);
    });
});
