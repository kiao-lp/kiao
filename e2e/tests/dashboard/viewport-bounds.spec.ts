import { test, expect, Locator, Page } from '../harness';

const TIMEOUT = 10000;

/**
 * E2E Test: nothing hangs out of the window, and the page never scrolls.
 *
 * Dashboard is a border layout — the window is the frame, and what has more to show than fits
 * scrolls inside its own pane. Two things used to break that, and both showed up at once on any
 * control sitting hard against the right edge. Ant Design keeps a tooltip anchored on its target
 * even when the two together no longer fit, so the tooltip stood a dozen pixels outside the
 * window; and because a tooltip is drawn in the page's body rather than in the pane it belongs to,
 * the page then grew to hold it and raised a scrollbar around the whole layout — a horizontal one,
 * and with it a vertical one, the frame being the window's height.
 *
 * The two halves are fixed in two places and both are asserted here: `cms-core/ui/Tooltip` slides
 * a tooltip back inside the window, and `App.css` pins html and body to the window so that no
 * popup can stretch the page again whatever else goes wrong.
 *
 * The configuration panel's **Re-read** button is the case that used to fail: it ships in the right
 * column, its header puts it flush against the panel's right edge — which is the window's — and
 * its tooltip is three times its own width.
 */

/** Wide enough for the right column to open beside a document rather than over it. */
const VIEWPORT = { width: 1100, height: 700 };

/**
 * Ant Design rounds a popup's offset to whole pixels, so a tooltip laid against an edge can end a
 * fraction of a pixel past it. One pixel of slack keeps that arithmetic out of these assertions:
 * it is nowhere near the dozen this test is about, and the page itself is held to exactly zero.
 */
const SUBPIXEL = 1;

/** The store open, the right column on, and the configuration panel it ships in showing. */
const openConfigurationPanel = async (page: Page): Promise<Locator> => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('smoke');
    // Loading the dev assembly under concurrent stacks can exceed the tooltip's timeout.
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: 30000 });

    const columnSwitch = page.getByTestId('bar-toggle-right');
    await expect(columnSwitch).toBeEnabled({ timeout: TIMEOUT });
    // App-wide and remembered, so a run that left it on must not turn it off again.
    if ((await columnSwitch.getAttribute('aria-label'))?.startsWith('Show')) await columnSwitch.click();

    const panel = page.getByTestId('toolbox-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUT });
    return panel.getByRole('button', { name: 'Re-read' });
};

/** Hovering a control and waiting for the tooltip it carries to be laid out. */
const tooltipOf = async (page: Page, control: Locator): Promise<Locator> => {
    await control.hover();
    const tip = page.locator('.ant-tooltip:not(.ant-tooltip-hidden)').first();
    await expect(tip).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(300); // let the alignment settle before measuring
    return tip;
};

const expectWhollyVisible = async (page: Page, tip: Locator, opened: string) => {
    const box = (await tip.boundingBox())!;
    const { width, height } = page.viewportSize()!;
    // A tooltip wider than the window has to overflow — such a case would prove nothing.
    expect(box.width, `the tooltip ${opened} is wider than the viewport`).toBeLessThanOrEqual(width);
    expect(box.x, `the tooltip ${opened} runs off the left`).toBeGreaterThanOrEqual(-SUBPIXEL);
    expect(box.x + box.width, `the tooltip ${opened} runs off the right`).toBeLessThanOrEqual(width + SUBPIXEL);
    expect(box.y, `the tooltip ${opened} runs off the top`).toBeGreaterThanOrEqual(-SUBPIXEL);
    expect(box.y + box.height, `the tooltip ${opened} runs off the bottom`).toBeLessThanOrEqual(height + SUBPIXEL);
};

/** What the page itself would scroll by, which in a border layout is nothing. */
const pageOverflow = (page: Page) => page.evaluate(() => {
    const html = document.documentElement;
    return {
        horizontal: html.scrollWidth - html.clientWidth,
        vertical: html.scrollHeight - html.clientHeight,
    };
});

test('a tooltip against the right edge of the window stays inside it', async ({ page }) => {
    const reRead = await openConfigurationPanel(page);
    const tip = await tooltipOf(page, reRead);
    await expectWhollyVisible(page, tip, "of the configuration panel's Re-read button");
});

test('the page has no scrollbars of its own, tooltip open or not', async ({ page }) => {
    const reRead = await openConfigurationPanel(page);
    expect(await pageOverflow(page), 'the page scrolls before anything is opened').toEqual({
        horizontal: 0, vertical: 0,
    });

    await tooltipOf(page, reRead);
    expect(await pageOverflow(page), 'a tooltip stretched the page').toEqual({
        horizontal: 0, vertical: 0,
    });
});
