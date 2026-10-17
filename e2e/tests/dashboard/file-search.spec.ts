import { test, expect } from '../harness';

const TIMEOUT = 10000;

/**
 * E2E Test: the file-search query language
 *
 * Three moving parts have to agree for a search to work — the Go matching engine in worker,
 * the `GET /search?path&query` contract, and the React search box — and no other test crosses all
 * three. The fixtures in `e2e/data/files-template/search/` are built for this: `alpha-beta.md` holds
 * the two words on *different lines*, which is exactly what the old per-line matching could not find.
 */

/** Types a query into the top-banner search box and presses Enter. */
const search = async (page: import('../harness').Page, query: string) => {
    const box = page.locator('.cms-top-banner').getByPlaceholder('Search');
    await box.fill(query);
    await box.press('Enter');
};

test('file search: query language end to end', async ({ page }) => {
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    await page.goto('search');
    await expect(page).toHaveURL(/search/);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // The results open as a panel on the central area's stack, over the folder listing.
    const panel = page.getByTestId('central-panel-file-search-results');
    const rows = panel.locator('.ant-table-tbody tr.ant-table-row');

    // 1. Two words, ANDed at document level: only the file holding both matches, even though they
    //    never share a line.
    await search(page, 'alpha beta');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('alpha-beta.md');

    // …and each matched line is shown with the hit marked, from the ranges the server computed.
    const marks = rows.first().locator('mark');
    await expect(marks).toHaveCount(2);
    await expect(marks.first()).toHaveText('alpha');
    await expect(marks.last()).toHaveText('beta');

    // 2. A bare word ignores case; the same text as a phrase does not.
    await search(page, 'ALPHA');
    await expect(rows).toHaveCount(2);
    await search(page, '"ALPHA"');
    await expect(rows).toHaveCount(0);

    // 3. A regex term, and the negation that removes one of its hits.
    await search(page, '/\\balpha\\b/');
    await expect(rows).toHaveCount(2);
    await search(page, 'alpha -beta');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('alpha-only.md');

    // 4. A file is findable by its name, which plain content search could never do.
    await search(page, 'alpha-only');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('alpha-only.md');

    // 5. A regex that does not compile is refused, and the box says so instead of going silent.
    await search(page, '/[/');
    await expect(page.locator('.cms-top-banner .ant-input-status-error')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByTestId('search-error-icon')).toBeVisible();

    // 6. Clearing the box drops the error and closes the panel — the folder listing was underneath
    //    all along.
    const box = page.locator('.cms-top-banner').getByPlaceholder('Search');
    await box.fill('');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('search-help-icon')).toBeVisible();
    await expect(page.locator('.cms-top-banner .ant-input-status-error')).toHaveCount(0);
    await expect(page.getByTestId('browser-item-search/alpha-beta.md')).toBeVisible();
    await expect(page.getByTestId('browser-item-search/alpha-only.md')).toBeVisible();

    // 7. The result panel carries the stack's floating cross, and takes the query with it when
    //    clicked.
    const closeSearch = page.getByTestId('central-panel-file-search-results-close');
    await expect(closeSearch).toHaveCount(0);
    await search(page, 'alpha');
    await expect(rows).toHaveCount(2);
    await expect(closeSearch).toBeVisible();

    await closeSearch.click();
    await expect(panel).toHaveCount(0);
    await expect(box).toHaveValue('');
    await expect(page.getByTestId('browser-item-search/alpha-beta.md')).toBeVisible();
});
