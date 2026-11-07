import { test, expect, Page } from '../harness';

/**
 * E2E: the markdown editor's synchronized source/preview scrolling.
 *
 * The promise is that the topmost element matches on both sides — raw on one,
 * rendered on the other. That only holds against real layout (CodeMirror's own
 * scroll geometry, wrapped lines, rendered block heights), so it is asserted here
 * rather than in unit tests.
 *
 * `smoke/scroll-sync.md` labels every line with `line=N`, so both panes can be
 * asked the same question — "which source line are you showing?" — and the answer
 * never depends on the sync code's own bookkeeping.
 */

const TIMEOUT = 15000;
/** Tolerance in source lines: blank lines between blocks make an exact match meaningless. */
const TOLERANCE = 3;

interface Panes {
    sourceLine: number | null;
    previewLine: number | null;
    editorScrollTop: number;
    previewScrollTop: number;
}

const readPanes = (page: Page): Promise<Panes> => page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const preview = (window as any).__preview() as HTMLElement;
    const firstVisible = (elements: Iterable<Element>, paneTop: number): number | null => {
        for (const element of elements) {
            if (element.getBoundingClientRect().bottom > paneTop + 1) {
                const match = /line=(\d+)/.exec(element.textContent || '');
                if (match) return Number(match[1]);
            }
        }
        return null;
    };
    return {
        sourceLine: firstVisible(document.querySelectorAll('.cm-line'), scroller.getBoundingClientRect().top),
        previewLine: firstVisible(preview.querySelectorAll('[data-source-line]'), preview.getBoundingClientRect().top),
        editorScrollTop: scroller.scrollTop,
        previewScrollTop: preview.scrollTop,
    };
});

const scrollSource = (page: Page, top: number) =>
    page.evaluate((to) => { document.querySelector('.cm-scroller')!.scrollTop = to; }, top);

const scrollPreview = (page: Page, top: number) =>
    page.evaluate((to) => { (window as any).__preview().scrollTop = to; }, top);

const open = async (page: Page) => {
    await page.goto('smoke/scroll-sync.md');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('[data-source-line]').first()).toBeVisible({ timeout: TIMEOUT });

    // Resolve the preview's scroll container once, by behaviour rather than by
    // walking a fixed number of parents.
    await page.evaluate(() => {
        (window as any).__preview = () => {
            let element = document.querySelector('.configured-markdown-container') as HTMLElement | null;
            while (element) {
                const overflow = getComputedStyle(element).overflowY;
                if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1) {
                    return element;
                }
                element = element.parentElement;
            }
            throw new Error('no scrollable preview container');
        };
    });
};

const syncToggle = (page: Page) => page.locator('button[aria-label="Synchronized scrolling"]');

test.describe('markdown editor scroll sync', () => {
    test('scrolling the source brings the same block to the top of the preview', async ({ page }) => {
        await open(page);

        await scrollSource(page, 1200);
        await page.waitForTimeout(300);

        const panes = await readPanes(page);
        expect(panes.previewScrollTop).toBeGreaterThan(50);
        expect(panes.sourceLine).not.toBeNull();
        expect(panes.previewLine).not.toBeNull();
        expect(Math.abs(panes.sourceLine! - panes.previewLine!)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('scrolling the preview brings the same line to the top of the source', async ({ page }) => {
        await open(page);

        await scrollPreview(page, 2000);
        await page.waitForTimeout(300);

        const panes = await readPanes(page);
        expect(panes.editorScrollTop).toBeGreaterThan(50);
        expect(Math.abs(panes.sourceLine! - panes.previewLine!)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the panes settle rather than pushing each other along', async ({ page }) => {
        await open(page);

        await scrollSource(page, 1500);
        await page.waitForTimeout(300);
        const settled = await readPanes(page);
        await page.waitForTimeout(600);
        const later = await readPanes(page);

        // Each pane echoing the other's correction would creep or oscillate here.
        expect(Math.abs(later.editorScrollTop - settled.editorScrollTop)).toBeLessThan(2);
        expect(Math.abs(later.previewScrollTop - settled.previewScrollTop)).toBeLessThan(2);
    });

    test('the switch is on by default and turns syncing off and back on', async ({ page }) => {
        await open(page);

        const toggle = syncToggle(page);
        await expect(toggle).toBeVisible({ timeout: TIMEOUT });
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        const before = await readPanes(page);
        await scrollSource(page, 2500);
        await page.waitForTimeout(300);
        const off = await readPanes(page);
        expect(Math.abs(off.previewScrollTop - before.previewScrollTop)).toBeLessThan(2);

        // Turning it back on realigns immediately, without waiting for a scroll.
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(400);
        const on = await readPanes(page);
        expect(Math.abs(on.sourceLine! - on.previewLine!)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the switch is hidden when only one pane is on screen', async ({ page }) => {
        await open(page);

        await page.locator('[data-testid="tool-bar-center"] .cms-tool-bar-controls button')
            .filter({ has: page.locator('[aria-label="eye"]') }).click();
        await expect(syncToggle(page)).toHaveCount(0);
    });
});
