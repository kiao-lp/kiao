import { test, expect, Page, workerApi, flushViewState } from '../harness';

/**
 * E2E: the view state Dashboard keeps in the `dashboard-view-state.json` config document.
 *
 * The promise is that a file reopens as it was left — the same panes, the same
 * place in the document — after a navigation and after a full page load. The
 * full page load is the point: it is what the OIDC redirect does when a token
 * renewal fails, and the reason the state lives on the server rather than in
 * component state.
 *
 * Asserted against the real app because every part of it is layout: the restore
 * waits for CodeMirror to have measured enough content to hold the offset, and
 * the offset is stored as a *line*, which only means anything against real
 * wrapping. `smoke/scroll-sync.md` labels each line with `line=N`, so "where am
 * I?" can be asked without trusting the mechanism's own bookkeeping.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/scroll-sync.md';
const STATE_DOC = 'dashboard-view-state.json';
/**
 * `useScrollMemory` hands the line it is on to the store 300ms after scrolling stops — its own
 * debounce, ahead of the store's. Flushing the store before that has gone by writes the offset
 * the document was opened at, which is not what was asked for.
 */
const RECORD_SETTLE_MS = 400;

interface ViewStateFile {
    version: number;
    global: Record<string, any>;
    folders: Record<string, any>;
    files: Record<string, any>;
}

const readState = async (): Promise<ViewStateFile | null> => {
    const response = await fetch(`${workerApi()}/config/${STATE_DOC}`);
    return response.ok ? response.json() as Promise<ViewStateFile> : null;
};

const open = async (page: Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
};

/** The `line=N` marker of whatever sits at the top of the source pane. */
const topSourceLine = (page: Page): Promise<number | null> => page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')!;
    const paneTop = scroller.getBoundingClientRect().top;
    for (const line of document.querySelectorAll('.cm-line')) {
        if (line.getBoundingClientRect().bottom > paneTop + 1) {
            const match = /line=(\d+)/.exec(line.textContent || '');
            if (match) return Number(match[1]);
        }
    }
    return null;
});

const scrollSource = (page: Page, top: number) => page.evaluate((to) => {
    document.querySelector('.cm-scroller')!.scrollTop = to;
}, top);

/**
 * The top line, once the pane has stopped moving under it.
 *
 * CodeMirror estimates the height of the lines it has not measured, so for a beat after a
 * scroll the line sitting at a given offset is still changing — and `useScrollMemory` records
 * the line it sees 300ms later, when it has settled. Reading the pane's first answer instead
 * took a line the app never recorded, and the reload then came back to a different one: a
 * two-line drift with nothing wrong in either half of what was being tested. Two identical
 * readings are what "settled" means here.
 */
const settledTopLine = async (page: Page): Promise<number> => {
    let previous: number | null = null;
    await expect.poll(async () => {
        const current = await topSourceLine(page);
        const settled = current !== null && current === previous;
        previous = current;
        return settled;
    }, { timeout: TIMEOUT }).toBe(true);
    return previous!;
};

const previewToggle = (page: Page) =>
    page.locator('button:has(.anticon-eye), button:has(.anticon-eye-invisible)').last();

test.describe('view state', () => {
    test('reopens a document at the line it was left on', async ({ page }) => {
        await open(page, FILE);
        await scrollSource(page, 1500);
        const before = await settledTopLine(page);
        await page.waitForTimeout(RECORD_SETTLE_MS);
        await flushViewState(page);
        // The line really is in the file, and it is a line well down it: an eager flush would
        // leave the reload restoring an older one, and this says so here rather than as an
        // off-by-two line number below.
        expect((await readState())?.files?.[FILE]?.scroll?.editorLine).toBeGreaterThan(10);

        // A full page load — everything in memory is gone, exactly as after the
        // login redirect a failed token renewal falls back to.
        await page.reload();
        await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });

        await expect.poll(() => topSourceLine(page), { timeout: TIMEOUT }).toBe(before);
    });

    test('reopens a document with the panes it was left with', async ({ page }) => {
        await open(page, FILE);
        const paneCount = () => page.locator('.cm-editor').count();
        await previewToggle(page).click();
        await flushViewState(page);
        const panes = await paneCount();

        await page.reload();
        await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });

        await expect.poll(paneCount, { timeout: TIMEOUT }).toBe(panes);
        const stored = (await readState())?.files?.[FILE]?.markdown;
        expect(stored).toMatchObject({ showPreview: false });
    });

    // The file is git-tracked, so an entry per file merely *opened* would be noise.
    test('writes nothing for a file that was only opened', async ({ page }) => {
        await open(page, 'smoke/roundtrip.md');
        await flushViewState(page);

        expect((await readState())?.files?.['smoke/roundtrip.md']).toBeUndefined();
    });

    // The state replaces what used to live in localStorage/sessionStorage; leaving
    // a copy there would let the two disagree.
    test('keeps no view state in browser storage', async ({ page }) => {
        await open(page, FILE);
        await scrollSource(page, 800);
        await page.waitForTimeout(RECORD_SETTLE_MS);
        await flushViewState(page);

        const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
        expect(keys.filter(k =>
            /theme|toolBars|fileBrowser|voice-language|mlscript-layout|zoom|activeTab/i.test(k)))
            .toEqual([]);
    });
});
