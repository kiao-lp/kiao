import { test, expect, Page, MINIMAL_APP } from '../harness';

/**
 * E2E: the same store, opened by a Dashboard assembled with two plugins.
 *
 * Every other spec runs against the complete assembly its worker's stack pins — the whole
 * delivered catalogue — because that is what makes them mean what they say. This one runs against
 * the other kind, on a stack of its own: `bin/start-minimal-assembly.sh` starts a Dashboard built
 * with `VITE_PLUGINS=code-edit,text-edit`, over a store that still asks for every
 * plugin the fixtures pin.
 *
 * What is being pinned is that **an absent plugin is not a failure anywhere**. A file nobody claims
 * is opened by the fallback rather than refused, and the Configuration panel says which of the
 * plugins the store asks for this build does not carry. Both are silent when they work — which is
 * exactly why they are worth a test.
 *
 * (Boards used to be covered here too, from a `.workflow.json` fixture. They are rows in
 * PostgreSQL now, opened at `/boards`, so there is no file for this assembly to open as one.)
 */

const TIMEOUT = 20000;

const loaded = async (page: Page) =>
    expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

test.describe('a minimal assembly', () => {
    // The store holds a real mindmap and asks for `mindmap-edit`; this build does not have it.
    // Nothing here refuses the file — `resolveFilePlugin` hands it to the fallback, and a mindmap
    // read as the JSON it is on disk is a document the user can still see and still copy out of.
    test('opens a file no plugin claims with the fallback editor', async ({ page }) => {
        await page.goto(`${MINIMAL_APP}/folder-a/Mindmap.mmap.json`);
        await loaded(page);

        await expect(page.locator('.cm-editor')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.mindmap-zoom-container')).toHaveCount(0);
        await expect(page).toHaveTitle(/Mindmap/);
    });

    // The Configuration panel is the one place the difference is *said*: this store names plugins
    // the build it is being read with does not carry, and the panel is where somebody finds out.
    test('says which of the plugins the store asks for this build does not carry', async ({ page }) => {
        await page.goto(`${MINIMAL_APP}/smoke/sample.txt`);
        await loaded(page);

        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Configuration…' }).click();

        await expect(page.getByTestId('plugin-row-code-edit')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId('plugin-row-mindmap-edit')).toHaveCount(0);
        await expect(page.getByText(/was not assembled with/)).toContainText('hybridflow');
    });
});
