import { test, expect, Locator, Page } from '../harness';

const TIMEOUT = 10000;

/** Tooltips stay within the viewport; pane overflow never makes the page scroll. */

/** Desktop layout for popup bounds checks. */
const VIEWPORT = { width: 1100, height: 700 };

/** Popup alignment can round an edge by one pixel. */
const SUBPIXEL = 1;

/** Open Configuration through the application menu. */
const openConfigurationPanel = async (page: Page): Promise<Locator> => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('smoke');
    // Loading the dev assembly under concurrent stacks can exceed the tooltip's timeout.
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.locator('.ant-dropdown-menu:visible').getByText('Configuration…', { exact: true }).click();

    const panel = page.getByTestId('toolbox-panel');
    await expect(panel).toBeVisible({ timeout: TIMEOUT });
    return panel;
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

test('a conventional close control has an accessible name and no tooltip', async ({ page }) => {
    await openConfigurationPanel(page);
    const close = page.getByTestId('central-panel-toolbox-close');
    await expect(close).toHaveAccessibleName('Close');
    await expect(close).not.toHaveAttribute('title');
    await close.hover({ timeout: TIMEOUT });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
});

const openEdgeTooltip = async (page: Page) => {
    const panel = await openConfigurationPanel(page);
    const kind = panel.locator('[role="img"][aria-label="Plugin"]').last();
    // Position the real trigger at the viewport edge to exercise popup alignment.
    await kind.evaluate(element => {
        Object.assign((element as HTMLElement).style, { position: 'fixed', right: '0', top: '80px' });
    });
    return tooltipOf(page, kind);
};

test('an explanatory tooltip stays inside the window and uses at most 16 words', async ({ page }) => {
    const tip = await openEdgeTooltip(page);
    await expectWhollyVisible(page, tip, 'of a plugin kind icon');
    expect((await tip.innerText()).split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(16);
});

test('the page has no scrollbars of its own, tooltip open or not', async ({ page }) => {
    await openConfigurationPanel(page);
    expect(await pageOverflow(page), 'the page scrolls before anything is opened').toEqual({
        horizontal: 0, vertical: 0,
    });

    await openEdgeTooltip(page);
    const overflow = await pageOverflow(page);
    expect(overflow.horizontal, 'a tooltip stretched the page horizontally').toBeLessThanOrEqual(SUBPIXEL);
    expect(overflow.vertical, 'a tooltip stretched the page vertically').toBe(0);
});
