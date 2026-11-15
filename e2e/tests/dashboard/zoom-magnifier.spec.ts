import { test, expect, Page, Locator } from '../harness';

/**
 * E2E: the magnifier.
 *
 * Ctrl-clicking something that can be magnified — one run of prose in a chat reply, a rendered
 * diagram — picks it out, and the top banner grows a slider for it. What the slider does is the
 * whole point and is asserted here in the browser, because none of it is arithmetic that a unit
 * test can settle: the element has to leave the flow without the page behind it moving, float over
 * its neighbours instead of pushing them, stay inside the window, and go back exactly where it was.
 *
 * A markdown diagram is the subject rather than a chat reply: it needs no model, no socket and no
 * quota, and it exercises the same core service through the same document-level interaction — the
 * chat marks each of a reply's text blocks with `data-zoomable`, a fenced block is a target on its
 * own.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/diagram-in-markdown.md';

/** Wide enough for a diagram at twice its size, short enough to make containment mean something. */
const VIEWPORT = { width: 1280, height: 800 };

interface Box { x: number; y: number; width: number; height: number; }

/** Sub-pixel differences are rounding, not movement. */
const expectSameBox = (actual: Box | null, expected: Box, what: string) => {
    expect(actual, `${what} is gone`).not.toBeNull();
    expect(Math.abs(actual!.x - expected.x), `${what} moved sideways`).toBeLessThan(1);
    expect(Math.abs(actual!.y - expected.y), `${what} moved vertically`).toBeLessThan(1);
    expect(Math.abs(actual!.width - expected.width), `${what} changed width`).toBeLessThan(1);
    expect(Math.abs(actual!.height - expected.height), `${what} changed height`).toBeLessThan(1);
};

const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The rendered half of the markdown editor — the source pane holds the same words. */
const openDocument = async (page: Page, viewport = VIEWPORT): Promise<Locator> => {
    await page.setViewportSize(viewport);
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.archdia-svg').first()).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(500); // both diagrams laid out before anything is measured
    return page.locator('.configured-markdown-container').first();
};

/** How the reader picks a target: Ctrl held down — Cmd on a Mac — and one click. */
const pick = (target: Locator) => target.click({ modifiers: ['ControlOrMeta'] });

/** The middle of an element, in the window's own coordinates. */
const centre = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * A finger put on the middle of `target` and held there long enough to mean it — the same pick,
 * on a tablet, where there is no Ctrl key to hold.
 *
 * Driven through CDP rather than through `page.touchscreen`, which only knows how to tap: the half
 * second in between is the whole of what is being tested, so the press is held open by hand. Real
 * touch input, so what the app reads is what a tablet sends — a `pointerdown` with a pointer type
 * of its own, and the platform's own long-press behaviour running against it.
 */
const hold = async (page: Page, target: Locator, ms = 700) => {
    const point = await centre(target);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
};

const setSliderToMaximum = async (page: Page) => {
    await page.locator('.cms-zoom-slider .ant-slider-handle').focus();
    await page.keyboard.press('End');
    await expect(page.locator('.cms-zoom-readout')).toHaveText('200%');
};

const resize = async (page: Page, edge: string, dx: number, dy: number) => {
    const point = await centre(page.locator(`[data-cms-zoom-resize="${edge}"]`));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
    await page.mouse.up();
};

test('magnifies a diagram over the page without moving the page', async ({ page }) => {
    const preview = await openDocument(page);
    const diagram = preview.locator('.code-block-wrapper').first();
    const behind = preview.getByText('A prose paragraph between the diagrams.');

    const slot = (await diagram.boundingBox())!;
    const behindAt = (await behind.boundingBox())!;

    // Nothing is selected, so the banner offers nothing.
    await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);

    // Picking already magnifies — a Ctrl-click that gave back the same size would say nothing
    // happened — and the paragraph below it has still not moved.
    await pick(diagram);
    await expect(page.locator('.cms-zoom-readout')).toHaveText('125%');
    expect((await diagram.boundingBox())!.width / slot.width).toBeGreaterThan(1.15);
    expectSameBox(await behind.boundingBox(), behindAt, 'the paragraph below');

    await setSliderToMaximum(page);
    const drawn = (await diagram.boundingBox())!;

    // Twice the size, and by `zoom` — the content is laid out again at that size rather than
    // stretched, which is what gives a redrawn diagram instead of bigger pixels.
    expect(drawn.width / slot.width).toBeGreaterThan(1.95);
    expect(drawn.width / slot.width).toBeLessThan(2.05);
    expect(drawn.height).toBeGreaterThan(slot.height);
    expect(await diagram.evaluate(element => getComputedStyle(element).zoom)).toBe('2');

    // The space it left is held open, so what was behind it is where it was…
    await expect(preview.locator('[data-cms-zoom-placeholder]')).toHaveCount(1);
    expectSameBox(await behind.boundingBox(), behindAt, 'the paragraph below');
    // …and it is over that paragraph rather than through it.
    expect(overlaps(drawn, behindAt), 'the magnified diagram floats over nothing').toBe(true);

    // Inside the window, and clear of the bar carrying the slider that shrinks it again.
    const banner = (await page.locator('.cms-top-banner').boundingBox())!;
    expect(drawn.x).toBeGreaterThanOrEqual(0);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(drawn.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(VIEWPORT.height);

    // Escape gives the document back, unchanged.
    await page.keyboard.press('Escape');
    await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);
    await expect(preview.locator('[data-cms-zoom-placeholder]')).toHaveCount(0);
    expectSameBox(await diagram.boundingBox(), slot, 'the diagram, put back');
    expectSameBox(await behind.boundingBox(), behindAt, 'the paragraph below, put back');
});

test('a second Ctrl-click puts the diagram back, and prose is not a target', async ({ page }) => {
    const preview = await openDocument(page);
    const diagram = preview.locator('.code-block-wrapper').first();
    const slot = (await diagram.boundingBox())!;

    await pick(diagram);
    await setSliderToMaximum(page);
    expect((await diagram.boundingBox())!.width).toBeGreaterThan(slot.width);

    await pick(diagram);
    await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);
    expectSameBox(await diagram.boundingBox(), slot, 'the diagram, put back');

    // A rendered document is prose and diagrams. Only the diagrams are targets, and Ctrl-clicking
    // the prose between them must not turn it into one.
    await pick(preview.getByText('A prose paragraph before the diagram.'));
    await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);
});

test('what is too large for the window scrolls inside itself', async ({ page }) => {
    // Short enough that a diagram at 200% cannot fit, which is the ordinary case for a long passage
    // of prose in a full-height window.
    const short = { width: 1280, height: 420 };
    const preview = await openDocument(page, short);
    const diagram = preview.locator('.code-block-wrapper').first();

    await pick(diagram);
    await setSliderToMaximum(page);

    const drawn = (await diagram.boundingBox())!;
    const banner = (await page.locator('.cms-top-banner').boundingBox())!;
    expect(drawn.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(short.height);

    // Held inside the window, and the rest reachable rather than cut off. Sent past its end rather
    // than down by a fixed number of pixels: how much there is to scroll follows the width of the
    // pane the diagram is laid out in, which is nothing this spec sets, and the end is the whole
    // of it however wide that pane came out.
    const scroll = await diagram.evaluate((element: HTMLElement) => {
        element.scrollTop = element.scrollHeight;
        return { overflow: element.scrollHeight - element.clientHeight, scrolled: element.scrollTop };
    });
    expect(scroll.overflow, 'nothing was left to scroll to').toBeGreaterThan(0);
    // A pixel apart is the same end: `scrollTop` is in the element's own units and the two lengths
    // it is compared against are the zoomed layout rounded to integers, so the magnification is
    // free to leave a rounding step between them.
    expect(Math.abs(scroll.scrolled - scroll.overflow), 'the element did not take the scroll')
        .toBeLessThanOrEqual(1);

    // And a bar saying so, drawn before it is used rather than fading in once something moves — a
    // passage cut off at the bottom of the screen with no scrollbar reads as one that simply ends.
    // Headless Chromium draws no scrollbar at all, so what is asserted is that the rule reserving
    // one is in force; setting `scrollbar-width` anywhere on this element would drop it.
    const bar = await diagram.evaluate(element =>
        getComputedStyle(element, '::-webkit-scrollbar').width);
    expect(bar, 'the floating element has no scrollbar of its own').toBe('10px');

    // Reading down a passage does not move the passage.
    await page.waitForTimeout(200);
    expectSameBox(await diagram.boundingBox(), drawn, 'the magnified diagram, scrolled');
});

test('continues zooming content after reaching both viewport limits', async ({ page }) => {
    const preview = await openDocument(page, { width: 1280, height: 420 });
    const diagram = preview.locator('.code-block-wrapper').first();
    const drawing = diagram.locator('.archdia-svg');
    await diagram.evaluate((element: HTMLElement) => {
        element.style.width = '1100px';
        element.style.maxWidth = 'none';
    });
    const original = (await drawing.boundingBox())!;
    await pick(drawing);
    await expect(page.locator('.cms-zoom-readout')).toHaveText('125%');
    const capped = (await diagram.boundingBox())!;
    const enlarged = (await drawing.boundingBox())!;
    expect(Math.abs(enlarged.width / original.width - 1.25)).toBeLessThan(0.01);
    expect(Math.abs(capped.width - 1264)).toBeLessThan(1);

    await setSliderToMaximum(page);
    const further = (await drawing.boundingBox())!;
    expect(Math.abs(further.width / enlarged.width - 1.6)).toBeLessThan(0.01);
    expect(Math.abs(further.height / enlarged.height - 1.6)).toBeLessThan(0.01);
    expectSameBox(await diagram.boundingBox(), capped, 'the capped popup');
    const scroll = await diagram.evaluate((element: HTMLElement) => {
        element.scrollLeft = element.scrollWidth;
        element.scrollTop = element.scrollHeight;
        return { x: element.scrollLeft, y: element.scrollTop };
    });
    expect(scroll.x).toBeGreaterThan(0);
    expect(scroll.y).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    expectSameBox(await diagram.boundingBox(), capped, 'the scrolled popup');
});

test('resizes from every border and a corner without scaling the content', async ({ page }) => {
    const preview = await openDocument(page);
    const diagram = preview.locator('.code-block-wrapper').first();
    const drawing = diagram.locator('.archdia-svg');
    const behind = preview.getByText('A prose paragraph between the diagrams.');
    const slot = (await diagram.boundingBox())!;
    const behindAt = (await behind.boundingBox())!;
    await pick(diagram);
    const original = (await diagram.boundingBox())!;
    const content = (await drawing.boundingBox())!;

    await resize(page, 'right', -100, 0);
    expectSameBox(await diagram.boundingBox(), { ...original, width: original.width - 100 }, 'right border');
    await resize(page, 'bottom', 0, -80);
    expectSameBox(await diagram.boundingBox(), {
        ...original, width: original.width - 100, height: original.height - 80,
    }, 'bottom border');
    await resize(page, 'left', 60, 0);
    await resize(page, 'top', 0, 40);
    const smaller = {
        x: original.x + 60, y: original.y + 40, width: original.width - 160, height: original.height - 120,
    };
    expectSameBox(await diagram.boundingBox(), smaller, 'left and top borders');
    await resize(page, 'bottom-right', 50, 40);
    const resized = { ...smaller, width: smaller.width + 50, height: smaller.height + 40 };
    expectSameBox(await diagram.boundingBox(), resized, 'corner');
    expect(Math.abs((await drawing.boundingBox())!.width - content.width)).toBeLessThan(1);
    expect(Math.abs((await drawing.boundingBox())!.height - content.height)).toBeLessThan(1);
    expectSameBox(await behind.boundingBox(), behindAt, 'the paragraph below');

    await setSliderToMaximum(page);
    expectSameBox(await diagram.boundingBox(), resized, 'the resized popup after zooming');
    expect(Math.abs((await drawing.boundingBox())!.width / content.width - 1.6)).toBeLessThan(0.01);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-cms-zoom-resize]')).toHaveCount(0);
    expectSameBox(await diagram.boundingBox(), slot, 'the restored diagram');
    expectSameBox(await behind.boundingBox(), behindAt, 'the restored paragraph');
});

/**
 * The one thing that decides whether the magnifier works in the chat at all, and it is invisible in
 * review: an element carrying a transform becomes the containing block of everything positioned
 * `fixed` below it, so a message row that kept one would lay a magnified text block out inside the
 * transcript — and let the transcript clip it — instead of over the page.
 *
 * That is a property of the chat's stylesheet rather than of any conversation, which is why the
 * fixture here is the shape the stylesheet keys on: the row, the bubble, and the text block inside
 * it that is what a Ctrl-click actually magnifies. Driving a real transcript would mean spending
 * a model turn to assert a rule about CSS.
 */
test('a reply\'s text block is not trapped inside the transcript it floats out of', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    await page.evaluate(() => {
        const area = document.createElement('div');
        area.id = 'zoom-probe';
        area.className = 'chat-messages-area';
        area.style.cssText = 'position:absolute;top:200px;left:300px;width:300px;height:200px;overflow:auto';
        const row = document.createElement('div');
        row.className = 'chat-message chat-message--assistant';
        const bubble = document.createElement('div');
        bubble.className = 'chat-message-bubble';
        const block = document.createElement('div');
        block.className = 'chat-text-block';
        block.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px';
        bubble.append(block);
        row.append(bubble);
        area.append(row);
        document.body.append(area);
    });
    // The row does carry a transform while it is arriving — that is the entrance animation, and it
    // is over long before anything can be Ctrl-clicked. What must not survive it is the transform.
    await page.waitForTimeout(400);

    const box = await page.evaluate(() => {
        const block = document.querySelector('#zoom-probe .chat-text-block')!;
        const { left, top } = block.getBoundingClientRect();
        document.getElementById('zoom-probe')!.remove();
        return { left, top };
    });

    expect(box, 'a settled message row still establishes a containing block').toEqual({ left: 0, top: 0 });
});

/**
 * The tablet's half of the same service.
 *
 * A reader on a tablet has no Ctrl key, so the pick is a long press instead; everything after it —
 * the slider, the floating, Escape — is the desktop's and is asserted above. What is asserted here
 * is only what the gesture itself has to get right, and none of it can be settled without a
 * browser: real touch input, the platform's own long press running against ours, and the tap the
 * browser sends afterwards, which would otherwise do whatever was under the finger as well.
 */
test.describe('the long press, where there is no Ctrl key to hold', () => {
    test.use({ hasTouch: true });

    test('holding a diagram magnifies it, and holding it again puts it back', async ({ page }) => {
        const preview = await openDocument(page);
        const diagram = preview.locator('.code-block-wrapper').first();
        const behind = preview.getByText('A prose paragraph between the diagrams.');
        const slot = (await diagram.boundingBox())!;
        const behindAt = (await behind.boundingBox())!;

        await hold(page, diagram);
        await expect(page.locator('.cms-zoom-readout')).toHaveText('125%');
        expect((await diagram.boundingBox())!.width / slot.width).toBeGreaterThan(1.15);
        expectSameBox(await behind.boundingBox(), behindAt, 'the paragraph below');

        // A second long press is the second Ctrl-click: the only way back on a device with no
        // Escape key, and the reason the gesture has to be a toggle.
        await hold(page, diagram);
        await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);
        expectSameBox(await diagram.boundingBox(), slot, 'the diagram, put back');
    });

    test('a tap is still a tap, and prose is still not a target', async ({ page }) => {
        const preview = await openDocument(page);
        const diagram = preview.locator('.code-block-wrapper').first();

        // Tapping a diagram to scroll past it, or to put the caret in the source beside it, is not
        // a pick — only holding it is.
        const point = await centre(diagram);
        await page.touchscreen.tap(point.x, point.y);
        await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);

        // And a press that lands nowhere near a target stays the platform's own gesture.
        await hold(page, preview.getByText('A prose paragraph before the diagram.'));
        await expect(page.locator('.cms-zoom-slider')).toHaveCount(0);
    });
});
