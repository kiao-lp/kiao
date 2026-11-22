import { test, expect, workerApi } from '../../harness';

/**
 * E2E Test: instantiating a template into a markdown file
 *
 * The "Instantiate" button of the instantiation tab turns what the preview shows into a file of its
 * own, next to the template and under the same name. `templates/Greeting.temp.md` is used rather
 * than `Prompt.temp.md` because it has nothing to fill in: its instantiation is fixed text, so the
 * test configures no value at all.
 */

const TEMPLATE_PATH = 'templates/Greeting.temp.md';
const INSTANTIATION_PATH = 'templates/Greeting.md';

// The instantiation as the file holds it: the markdown source the preview is rendered from.
const EXPECTED = 'Hello from the Greeting template.\n\n**Nothing to fill in** — this text is the whole instantiation.';

const readInstantiation = async (request: import('../../harness').APIRequestContext) => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(INSTANTIATION_PATH)}`);
    expect(response.ok()).toBeTruthy();
    return response.text();
};

test.describe('template instantiation to a markdown file', () => {

    test.afterEach(async ({ request }) => {
        // The instantiation lands in the shared data root, so it must not outlive the test.
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(INSTANTIATION_PATH)}`);
    });

    test('the Instantiate button writes the markdown next to the template', async ({ page, request }) => {
        await page.goto(TEMPLATE_PATH);

        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('heading', { name: 'Greeting' })).toBeVisible({ timeout: 10000 });

        // Templates are always markdown: the preview is rendered, and Instantiate is always offered.
        const preview = page.getByTestId('template-preview');
        await expect(preview).toBeVisible({ timeout: 10000 });
        await expect(preview).toContainText('Hello from the Greeting template.');
        await expect(preview).toContainText('Nothing to fill in');

        const instantiateButton = page.getByRole('button', { name: 'Instantiate' });
        await expect(instantiateButton).toBeVisible();

        await instantiateButton.click();
        await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 10000 });

        // The file holds the instantiation, not the template it came from.
        const written = await readInstantiation(request);
        expect(written).not.toContain('### textTemplate');
        expect(written.trim()).toBe(EXPECTED);

        // Instantiating again overwrites, once the replacement is confirmed.
        await instantiateButton.click();
        const confirmDialog = page.locator('.ant-modal-confirm');
        await expect(confirmDialog).toBeVisible({ timeout: 10000 });
        await expect(confirmDialog).toContainText('Replace Greeting.md?');
        await confirmDialog.locator('button:has-text("Replace")').click();
        await expect(confirmDialog).toBeHidden({ timeout: 10000 });

        expect(await readInstantiation(request)).toBe(written);
    });
});
