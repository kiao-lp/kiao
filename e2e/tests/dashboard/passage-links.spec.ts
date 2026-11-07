import { test, expect, Page } from '../harness';

/**
 * E2E: text fragments — a passage of a document named by the words it is made of.
 *
 * The URL carries the terms under a plain `#text=`, not the specification's `#:~:text=`: Chrome
 * strips a fragment directive from `location.hash` on load and from `history.pushState`, so a page
 * can never read one back. That is asserted here too, since it is the one thing about the grammar
 * a unit test cannot see.
 *
 * Every promise this feature makes is a promise about a real browser. That the passage is *found*
 * is settled by unit tests; what is settled here is what only real layout can answer: that it ends
 * up where it reads best rather than merely on screen, that the highlight is actually painted, and
 * that a link copied out of a selection comes back to that selection and not to the passage above
 * it that reads exactly the same.
 *
 * `smoke/passage-link.md` puts the same sentence in two wings far apart for that last one, and a
 * unique passage — the lantern — with enough document after it to be placed freely.
 */

const TIMEOUT = 15000;

/** The rendered document, as opposed to the source pane, which holds the same words. */
const rendered = (page: Page) => page.locator('.configured-markdown-container');

const LANTERN = 'The lantern is lit at dusk and put out at dawn.';
const REPEATED = 'the frame is drawn once and read twice';

/** Where the fragment is resolved, and the element whose viewport the passage is placed in. */
const installPreviewProbe = (page: Page) => page.evaluate(() => {
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

interface Painted {
    /** The words the browser is painting, or null when it is painting nothing. */
    text: string | null;
    /** The block holding them — how the two wings are told apart. */
    block: string;
    /** How far down the pane the passage sits, as a share of its height. */
    ratio: number;
    /** Whether it is on screen at all. */
    visible: boolean;
}

const painted = (page: Page): Promise<Painted> => page.evaluate(() => {
    const highlight = CSS.highlights?.get('dashboard-passage');
    const range = highlight ? ([...highlight][0] as Range | undefined) : undefined;
    if (!range) return { text: null, block: '', ratio: NaN, visible: false };

    const pane = (window as any).__preview() as HTMLElement;
    const passage = range.getBoundingClientRect();
    const box = pane.getBoundingClientRect();
    const start = range.startContainer;
    const element = (start.nodeType === Node.TEXT_NODE ? start.parentElement : start as Element);
    return {
        text: range.toString(),
        block: element?.closest('p, h1, h2, li')?.textContent ?? '',
        ratio: (passage.top - box.top) / box.height,
        visible: passage.top >= box.top && passage.bottom <= box.bottom,
    };
});

const open = async (page: Page, fragment: string = '') => {
    await page.goto(`smoke/passage-link.md${fragment}`);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(rendered(page).getByText(LANTERN)).toBeAttached({ timeout: TIMEOUT });
    await installPreviewProbe(page);
};

/**
 * A reader sweeping through `needle` with the mouse and right-clicking what they swept.
 *
 * The gesture is made rather than simulated — a selection set through the DOM does not survive the
 * right-click that follows, since the browser judges the click outside it and collapses it, which
 * is exactly the case the feature has to work in.
 */
const rightClickOnSelection = async (page: Page, needle: string, occurrence: number) => {
    await page.evaluate(({ needle, occurrence }) => {
        const pane = (window as any).__preview() as HTMLElement;
        const blocks = [...pane.querySelectorAll('p')]
            .filter(block => (block.textContent ?? '').toLowerCase().includes(needle));
        blocks[occurrence].scrollIntoView({ block: 'center' });
    }, { needle, occurrence });
    // The pane carries the source pane along with it; the words are read once both have settled.
    await page.waitForTimeout(400);

    const sweep = await page.evaluate(({ needle, occurrence }) => {
        const pane = (window as any).__preview() as HTMLElement;
        const block = [...pane.querySelectorAll('p')]
            .filter(block => (block.textContent ?? '').toLowerCase().includes(needle))[occurrence];
        const text = block.firstChild as Text;
        const at = text.data.toLowerCase().indexOf(needle);
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + needle.length);
        const rect = range.getBoundingClientRect();
        return { from: rect.left + 2, to: rect.right - 2, y: rect.top + rect.height / 2 };
    }, { needle, occurrence });

    await page.mouse.move(sweep.from, sweep.y);
    await page.mouse.down();
    await page.mouse.move(sweep.to, sweep.y, { steps: 12 });
    await page.mouse.up();
    await page.mouse.click((sweep.from + sweep.to) / 2, sweep.y, { button: 'right' });
};

test.describe('opening a document on the passage its URL names', () => {
    test('scrolls it into view, high in the pane rather than merely on screen', async ({ page }) => {
        await open(page, '#text=The%20lantern%20is%20lit%20at%20dusk');

        await expect.poll(async () => (await painted(page)).text, { timeout: TIMEOUT })
            .toBe('The lantern is lit at dusk');

        const place = await painted(page);
        expect(place.visible).toBe(true);
        // Not at the very top, where the sentences leading in would be off screen, and not the
        // dead centre the browser's own scroll-to-text would have chosen.
        expect(place.ratio).toBeGreaterThan(0.1);
        expect(place.ratio).toBeLessThan(0.45);
    });

    test('follows one written into the document, without reloading the app', async ({ page }) => {
        await open(page);
        // Survives an in-app navigation and not a page load — which is the whole point: the fragment
        // rides `history.pushState`, where the specification's `:~:` would have been stripped.
        await page.evaluate(() => { (window as any).__sameDocument = true; });

        await rendered(page).getByRole('link', { name: 'Jump to the lantern' }).click();

        await expect.poll(async () => (await painted(page)).text, { timeout: TIMEOUT })
            .toBe('The lantern is lit at dusk');
        expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
    });

    test('leaves a document whose URL names no passage where its memory put it', async ({ page }) => {
        await open(page);
        await page.waitForTimeout(500);
        expect((await painted(page)).text).toBeNull();
    });

    test('says so, rather than opening silently at the top, when the words have gone', async ({ page }) => {
        await open(page, '#text=no%20such%20words%20in%20this%20document');
        await expect(page.getByText('That passage is not in this document any more.'))
            .toBeVisible({ timeout: TIMEOUT });
    });
});

test.describe('copying a link to a selected passage', () => {
    test('comes back to the passage it was made from, not to the one that reads the same',
        async ({ page, context }) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
            await open(page);

            await rightClickOnSelection(page, REPEATED, 1);
            await page.getByText('Copy link to this passage').click();

            await page.bringToFront();
            const link = await page.evaluate(() => navigator.clipboard.readText());
            expect(link).toContain('#text=');
            expect(link).not.toContain(':~:');

            await page.goto(link);
            await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
            await installPreviewProbe(page);

            await expect.poll(async () => (await painted(page)).block, { timeout: TIMEOUT })
                .toContain('south wing');
        });

    test('leaves the browser its own menu where nothing is selected', async ({ page }) => {
        await open(page);
        await rendered(page).locator('p').first().click({ button: 'right' });
        await expect(page.getByText('Copy link to this passage')).toHaveCount(0);
    });
});
