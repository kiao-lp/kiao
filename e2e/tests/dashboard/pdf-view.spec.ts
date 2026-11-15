import { test, expect, Page, flushViewState } from '../harness';

/**
 * E2E: the PDF viewer as one continuous, lazily rendered column.
 *
 * The two halves of the promise pull against each other, which is why this is asserted against
 * the real app rather than in a unit test. The whole document must be there to scroll through —
 * `smoke/manual.pdf` is forty pages, each printing its own number, one of them landscape — while
 * only the pages around the viewport may actually be rasterised, since a canvas per page is what
 * a long document cannot afford. So the specs below check both at once: the scroller spans forty
 * pages, and no more than a handful of them exist in the DOM at any moment.
 */

const TIMEOUT = 20000;
const FILE = 'smoke/manual.pdf';
const PAGES = 40;
/** The viewport plus one overscanned page either side; anything more is not lazy. */
const MOST_MOUNTED = 6;

const SCROLLER = '.pdf-column-scroller';

const open = async (page: Page) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.react-pdf__Page').first()).toBeVisible({ timeout: TIMEOUT });
};

/**
 * The same, wound back to page one. The viewer remembers where the document was left, and these
 * specs share one store: without this each would open wherever its predecessor stopped reading.
 */
const openAtStart = async (page: Page) => {
    await open(page);
    await counter(page).fill('1');
    await counter(page).press('Enter');
    await expect.poll(() => counter(page).inputValue(), { timeout: TIMEOUT }).toBe('1');
};

/** The page numbers currently in the DOM, in order. */
const mountedPages = (page: Page): Promise<number[]> => page.evaluate(() =>
    Array.from(document.querySelectorAll('.react-pdf__Page'))
        .map(el => Number(el.getAttribute('data-page-number')))
        .sort((a, b) => a - b));

const scrollTo = (page: Page, top: number) => page.evaluate((to) => {
    document.querySelector('.pdf-column-scroller')!.scrollTop = to;
}, top);

/** The page filling the middle of the viewport — what a reader would call the page they are on. */
const pageOnScreen = (page: Page): Promise<number | null> => page.evaluate(() => {
    const scroller = document.querySelector('.pdf-column-scroller')!.getBoundingClientRect();
    const middle = scroller.top + scroller.height / 2;
    for (const el of document.querySelectorAll('.react-pdf__Page')) {
        const box = el.getBoundingClientRect();
        if (box.top <= middle && box.bottom >= middle) return Number(el.getAttribute('data-page-number'));
    }
    return null;
});

const scrollMetrics = (page: Page) => page.evaluate(() => {
    const el = document.querySelector('.pdf-column-scroller')!;
    return { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight };
});

/** What the document strip's counter reads. */
const counter = (page: Page) => page.locator('input[aria-label="Page number"]');

test.describe('pdf-view: a continuously scrolled column', () => {
    test('opens on page one with the whole document scrollable', async ({ page }) => {
        await openAtStart(page);

        await expect(page.locator('.react-pdf__Page[data-page-number="1"]')).toBeVisible();
        await expect(page.getByText(`/ ${PAGES}`)).toBeVisible({ timeout: TIMEOUT });

        // The scroller spans every page from the first frame, though only the first few exist.
        const { height, viewport } = await scrollMetrics(page);
        expect(height).toBeGreaterThan(viewport * 10);
        expect((await mountedPages(page)).length).toBeLessThanOrEqual(MOST_MOUNTED);
    });

    test('renders a page only once it is scrolled near', async ({ page }) => {
        await openAtStart(page);
        expect(await mountedPages(page)).not.toContain(20);

        const { height } = await scrollMetrics(page);
        await scrollTo(page, height / 2);

        // The page that arrives is the right one: each page of the fixture prints its number.
        const midway = page.locator('.react-pdf__Page[data-page-number="20"]');
        await expect(midway).toBeVisible({ timeout: TIMEOUT });
        await expect(midway).toContainText('Page 20', { timeout: TIMEOUT });

        // …and the pages left behind are gone rather than accumulating.
        const mounted = await mountedPages(page);
        expect(mounted.length).toBeLessThanOrEqual(MOST_MOUNTED);
        expect(mounted).not.toContain(1);
    });

    test('follows the scroll in the page counter, and the counter drives the scroll', async ({ page }) => {
        await openAtStart(page);

        const { height } = await scrollMetrics(page);
        await scrollTo(page, height / 2);
        // Which page the halfway mark lands on is the window's business, not this spec's; what
        // matters is that the counter names the page the reader is looking at.
        await expect.poll(() => pageOnScreen(page), { timeout: TIMEOUT }).not.toBeNull();
        expect(await counter(page).inputValue()).toBe(String(await pageOnScreen(page)));

        // Typing a page reaches it without scrolling through the ones in between.
        await counter(page).fill(String(PAGES));
        await counter(page).press('Enter');
        const last = page.locator(`.react-pdf__Page[data-page-number="${PAGES}"]`);
        await expect(last).toBeVisible({ timeout: TIMEOUT });
        await expect(last).toContainText(`Page ${PAGES}`, { timeout: TIMEOUT });
        expect((await mountedPages(page)).length).toBeLessThanOrEqual(MOST_MOUNTED);
    });

    test('steps a page at a time from the document strip', async ({ page }) => {
        await openAtStart(page);

        await page.locator('button[aria-label="Next page"]').click();
        await expect.poll(() => counter(page).inputValue(), { timeout: TIMEOUT }).toBe('2');
        await page.locator('button[aria-label="Previous page"]').click();
        await expect.poll(() => counter(page).inputValue(), { timeout: TIMEOUT }).toBe('1');
    });

    test('reopens where it was left', async ({ page }) => {
        await openAtStart(page);
        await counter(page).fill('26');
        await counter(page).press('Enter');
        await expect.poll(() => counter(page).inputValue(), { timeout: TIMEOUT }).toBe('26');
        await flushViewState(page);

        await open(page);
        await expect(counter(page)).toHaveValue('26', { timeout: TIMEOUT });
        await expect(page.locator('.react-pdf__Page[data-page-number="26"]')).toBeVisible({ timeout: TIMEOUT });
        // Reopening deep in the document must not have rendered the twenty-five pages above it.
        expect((await mountedPages(page)).length).toBeLessThanOrEqual(MOST_MOUNTED);
    });
});
