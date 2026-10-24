import { test, expect, Page } from '../harness';

/**
 * E2E: the divider between the parts of a divided centre — dragged, and seen.
 *
 * Both halves of this are the browser's own and cannot be asserted anywhere else. A drag reaches
 * the divider only if the page has taken the gesture off the browser (`touch-action`), which no
 * unit test applies a stylesheet to find out; and a divider is only findable if what it is drawn
 * in stands out from the pane beside it, which is a computed colour on a real theme.
 *
 * It is asserted with a finger because that is where it broke: the handles listened for mouse
 * events, which a touch screen sends only for a tap and never for a drag, so on a tablet the
 * divider did nothing at all.
 */

// A finger needs a screen that has one. Without it the browser routes no touch anywhere.
test.use({ hasTouch: true });

const TIMEOUT = 15000;
/** The divider between the markdown source and its preview. */
const HANDLE = '[data-testid="split-resize-preview"]';
/** WCAG's floor for something that is a control rather than decoration. */
const MIN_CONTRAST = 3;

const open = async (page: Page) => {
    await page.goto('smoke/scroll-sync.md');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator(HANDLE)).toBeVisible({ timeout: TIMEOUT });
};

const partWidth = (page: Page, name: string): Promise<number> => page.evaluate(
    part => document.querySelector(`[data-split-part="${part}"]`)!.getBoundingClientRect().width,
    name,
);

/**
 * A real finger rather than a synthesised event: `Input.dispatchTouchEvent` goes in ahead of the
 * browser's own gesture handling, so a strip that had not claimed the gesture would scroll the page
 * here exactly as it does on the tablet, and move nothing. Several moves, as a finger sends.
 */
const dragByTouch = async (page: Page, from: { x: number; y: number }, by: number) => {
    const cdp = await page.context().newCDPSession(page);
    const at = (x: number) => [{ x, y: from.y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x) });
    for (const part of [0.25, 0.6, 1]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.x + by * part) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
};

/** WCAG relative luminance of a computed `rgb(...)`. */
const luminance = (colour: string): number => {
    const [r, g, b] = colour.match(/[\d.]+/g)!.slice(0, 3)
        .map(value => Number(value) / 255)
        .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (one: string, other: string): number => {
    const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
};

test.describe('the divider between the parts of the centre', () => {
    test('a finger drags it, and the panes it separates follow', async ({ page }) => {
        await open(page);
        const before = await partWidth(page, 'source');
        const strip = (await page.locator(HANDLE).boundingBox())!;

        await dragByTouch(page, { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 }, 200);

        // The whole 200 minus whatever the last move rounded off: the source takes what the
        // preview gives up, and nothing else on the row moves.
        await expect.poll(() => partWidth(page, 'source'), { timeout: TIMEOUT })
            .toBeGreaterThan(before + 150);
    });

    test('it is seen before it is reached for, rather than found by the cursor turning', async ({ page }) => {
        await open(page);

        const drawn = await page.locator(HANDLE).evaluate(strip => ({
            width: strip.getBoundingClientRect().width,
            gesture: getComputedStyle(strip).touchAction,
            line: getComputedStyle(strip, '::before').backgroundColor,
            pane: getComputedStyle(document.querySelector('[data-split-part="preview"]')!).backgroundColor,
        }));

        expect(drawn.gesture).toBe('none');
        expect(drawn.width).toBeGreaterThanOrEqual(9);
        expect(contrast(drawn.line, drawn.pane)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
});
