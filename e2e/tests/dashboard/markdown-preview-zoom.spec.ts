import { test, expect, Page, flushViewState } from '../harness';

/**
 * E2E: the size the markdown preview is read at.
 *
 * The select in the document's tab strip resizes the rendered document and nothing else — not
 * the source pane beside it, not the bar it sits in, not the column the preview was given. All of
 * that is layout, so it is asserted in a browser: `zoom` is not implemented by jsdom at all, and
 * what would break here is precisely what a unit test cannot see.
 *
 * Two things beyond the resizing itself are the reader's, and both are here: the passage being
 * read is still on screen after the change, and a document reopens at the size it was left at.
 * Its two neighbours are here for the same reason — the scroll sync measures the pane it has just
 * resized, and the magnifier is pointed at diagrams inside it.
 */

const TIMEOUT = 15000;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * A document of this spec's own: it labels every line, so "what is at the top of the preview" has
 * an answer, and it opens on a diagram, so what a magnifier is pointed at is in it too. It is not
 * shared with another spec because the size is written down per file and stays there — a document
 * this one left at 150% is a document the next spec would measure at 150%.
 */
const FILE = 'smoke/preview-zoom.md';

const zoomTo = async (page: Page, label: string) => {
    await page.locator('.markdown-preview-zoom .ant-select').click();
    await page.locator('.ant-select-dropdown .ant-select-item-option').getByText(label, { exact: true }).click();
    await expect(page.locator('.markdown-preview-zoom .ant-select')).toContainText(label);
    // The reflow is the browser's, and everything below is measured after it.
    await page.waitForTimeout(200);
};

const open = async (page: Page) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.configured-markdown-container')).toBeVisible({ timeout: TIMEOUT });

    // The preview's scroll container, resolved once by behaviour rather than by walking a fixed
    // number of parents — the box carrying the zoom is one of them, and it is not the one that
    // scrolls.
    await page.evaluate(() => {
        (window as any).__pane = () => {
            let element = document.querySelector('.configured-markdown-container') as HTMLElement | null;
            while (element) {
                if (getComputedStyle(element).overflowY === 'auto') return element;
                element = element.parentElement;
            }
            throw new Error('no scrollable preview container');
        };
    });

    // The size is remembered, so an earlier test — or an earlier run against the same store —
    // is what the document would otherwise open at. Everything below starts from the top of it,
    // at its own size.
    await page.evaluate(() => { (window as any).__pane().scrollTop = 0; });
    await zoomTo(page, '100%');
};

/** Where the pane is and how wide it is: what the zoom must not touch. */
const paneBox = (page: Page) => page.evaluate(() => {
    const { x, width } = (window as any).__pane().getBoundingClientRect();
    return { x, width };
});

const syncButton = (page: Page) => page.locator('button[aria-label="Synchronized scrolling"]');

/** Sync is remembered per file, so it is set rather than toggled. */
const setSync = async (page: Page, on: boolean) => {
    if (await syncButton(page).getAttribute('aria-pressed') !== String(on)) await syncButton(page).click();
    await expect(syncButton(page)).toHaveAttribute('aria-pressed', String(on));
};

/** The source line at the top of the editor pane. */
const topSourceLine = (page: Page) => page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const top = scroller.getBoundingClientRect().top;
    for (const line of scroller.querySelectorAll('.cm-line')) {
        if (line.getBoundingClientRect().bottom > top + 1) {
            const match = /line=(\d+)/.exec(line.textContent || '');
            if (match) return Number(match[1]);
        }
    }
    return null;
});

/** Whether the block rendered from `line` is anywhere in the pane's visible box. */
const onScreen = (page: Page, line: number) => page.evaluate((wanted) => {
    const pane = (window as any).__pane() as HTMLElement;
    const box = pane.getBoundingClientRect();
    const block = pane.querySelector(`[data-source-line="${wanted}"]`);
    if (!block) return false;
    const rect = block.getBoundingClientRect();
    return rect.bottom > box.top && rect.top < box.bottom;
}, line);

/** The source line of the first block the preview is showing. */
const topPreviewLine = (page: Page) => page.evaluate(() => {
    const pane = (window as any).__pane() as HTMLElement;
    const top = pane.getBoundingClientRect().top;
    for (const block of pane.querySelectorAll('[data-source-line]')) {
        if (block.getBoundingClientRect().bottom > top + 1) {
            const match = /line=(\d+)/.exec(block.textContent || '');
            if (match) return Number(match[1]);
        }
    }
    return null;
});

test('places preview controls to the right of the document tab, above the document', async ({ page }) => {
    await open(page);

    const strip = page.locator('[data-testid="tool-bar-center"] > .ant-tabs > .ant-tabs-nav');
    const controls = strip.locator('.cms-tool-bar-controls');
    await expect(strip).toBeVisible();
    await expect(controls.locator('.markdown-preview-zoom')).toBeVisible();
    await expect(page.locator('.cms-top-banner .markdown-preview-zoom')).toHaveCount(0);

    const tab = (await strip.getByRole('tab', { name: 'Document', exact: true }).boundingBox())!;
    const controlBox = (await controls.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    const documentBox = (await page.locator('.cms-document-area').boundingBox())!;
    expect(controlBox.x).toBeGreaterThanOrEqual(tab.x + tab.width);
    expect(Math.abs(controlBox.x + controlBox.width - stripBox.x - stripBox.width)).toBeLessThanOrEqual(10);
    expect(documentBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1);
});

test('draws the document larger without taking anything from the page around it', async ({ page }) => {
    await open(page);

    const heading = page.locator('.configured-markdown-container h1').first();
    const sourceLine = page.locator('.cm-line').first();
    const before = {
        heading: (await heading.boundingBox())!,
        source: (await sourceLine.boundingBox())!,
        pane: await paneBox(page),
    };

    await zoomTo(page, '150%');

    // Half again as large, and laid out again at that size rather than stretched: the heading is
    // taller by the factor, and the pane it is drawn in has neither moved nor changed width.
    const drawn = (await heading.boundingBox())!;
    expect(drawn.height / before.heading.height).toBeGreaterThan(1.4);
    expect(drawn.height / before.heading.height).toBeLessThan(1.6);
    expect(await paneBox(page)).toEqual(before.pane);
    // The width it is given is the pane's, so nothing runs off the side of it.
    expect(drawn.width).toBeLessThanOrEqual(before.pane.width);

    // The source is the text being typed, not the document being read: it keeps the editor's size.
    const source = (await sourceLine.boundingBox())!;
    expect(Math.abs(source.height - before.source.height)).toBeLessThan(1);
    expect(Math.abs(source.width - before.source.width)).toBeLessThan(1);

    // And back to its own size, which is what 100% means.
    await zoomTo(page, '100%');
    expect(Math.abs((await heading.boundingBox())!.height - before.heading.height)).toBeLessThan(1);
});

test('keeps the reader on the passage they were reading, and reopens at the size they left', async ({ page }) => {
    await open(page);

    // Halfway down a long document, with the panes left to themselves.
    await setSync(page, false);
    await page.evaluate(() => {
        const pane = (window as any).__pane() as HTMLElement;
        pane.scrollTop = pane.scrollHeight / 2;
    });
    await page.waitForTimeout(200);
    const wasReading = await topPreviewLine(page);
    expect(wasReading, 'the fixture put nothing at the top of the preview').not.toBeNull();

    await zoomTo(page, '150%');

    // The passage is still being read. Laying the document out again at another size moves every
    // pixel offset in it — half again as tall, the block that was at the top would be a third of
    // the way further up the pane and long gone off the bottom of it.
    expect(await onScreen(page, wasReading!), `line ${wasReading} was left behind`).toBe(true);

    // The size is the document's, remembered like the panes around it. Written before the reload
    // rather than by it: a document on its way out cannot be relied on to finish the round trip.
    await flushViewState(page);
    await page.reload();
    await expect(page.locator('.configured-markdown-container')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.markdown-preview-zoom .ant-select')).toContainText('150%');
});

test('a diagram magnified out of a zoomed preview still fits the window', async ({ page }) => {
    await open(page);
    await expect(page.locator('.archdia-svg').first()).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(500);

    await zoomTo(page, '150%');

    const diagram = page.locator('.configured-markdown-container .code-block-wrapper').first();
    // From the preview: the source pane holds the same words, and both are on screen.
    const below = page.locator('.configured-markdown-container').getByText('A prose paragraph after the diagram.');
    const slot = (await diagram.boundingBox())!;
    const belowAt = (await below.boundingBox())!;

    // Ctrl-click is how the magnifier picks a target, and the preview is where the targets are.
    await diagram.click({ modifiers: ['ControlOrMeta'] });
    await page.locator('.cms-zoom-slider .ant-slider-handle').focus();
    await page.keyboard.press('End');
    await expect(page.locator('.cms-zoom-readout')).toHaveText('200%');
    await page.waitForTimeout(200);

    // Magnified out of a pane already at 150%, it is still bound by the window rather than by that
    // 150% counted twice.
    const drawn = (await diagram.boundingBox())!;
    const banner = (await page.locator('.cms-top-banner').boundingBox())!;
    expect(drawn.x).toBeGreaterThanOrEqual(0);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(drawn.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(VIEWPORT.height);
    expect(drawn.width).toBeGreaterThan(slot.width);

    // And the space it left is the space it took: the paragraph under it has not moved.
    expect(Math.abs((await below.boundingBox())!.y - belowAt.y), 'the paragraph below moved').toBeLessThan(1);

    const drawing = diagram.locator('.archdia-svg');
    const content = (await drawing.boundingBox())!;
    const handle = (await page.locator('[data-cms-zoom-resize="right"]').boundingBox())!;
    const point = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 100, point.y, { steps: 5 });
    await page.mouse.up();
    const resized = (await diagram.boundingBox())!;
    expect(Math.abs(resized.width - (drawn.width - 100))).toBeLessThan(1);
    expect(Math.abs(resized.x - drawn.x)).toBeLessThan(1);
    expect(Math.abs((await drawing.boundingBox())!.width - content.width)).toBeLessThan(1);

    await page.locator('.cms-zoom-slider .ant-slider-handle').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.cms-zoom-readout')).toHaveText('195%');
    expect(Math.abs((await diagram.boundingBox())!.width - resized.width)).toBeLessThan(1);
    expect(Math.abs((await diagram.boundingBox())!.height - resized.height)).toBeLessThan(1);

    // Escape gives the document back, at the size the preview is set to.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(Math.abs((await diagram.boundingBox())!.width - slot.width)).toBeLessThan(1);
});

test('the panes stay in step at a size that is the preview\'s own', async ({ page }) => {
    await open(page);
    await setSync(page, true);
    await zoomTo(page, '150%');

    // The sync measures the rendered blocks against the pane they are in, and the pane is the one
    // thing the zoom does not touch — so the same line is at the top of both, at any size.
    await page.evaluate(() => { document.querySelector('.cm-scroller')!.scrollTop = 1200; });
    await page.waitForTimeout(400);

    const source = await topSourceLine(page);
    const preview = await topPreviewLine(page);
    expect(source, 'the source pane showed no labelled line').not.toBeNull();
    // Blank lines between blocks make an exact match meaningless; the tolerance is the scroll
    // sync spec's own.
    expect(Math.abs(preview! - source!), `source at ${source}, preview at ${preview}`).toBeLessThan(4);
});
