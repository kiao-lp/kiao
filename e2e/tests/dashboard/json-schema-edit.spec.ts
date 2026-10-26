import { test, expect, restoreFixture } from '../harness';

test.beforeEach(async ({ request }) => {
    await restoreFixture(request, 'smoke/person.schema.json');
});

test('validates schemas and completes keywords and valid values offline', async ({ page }) => {
    await page.route('https://json-schema.org/**', route => route.abort());
    await page.goto('smoke/person.schema.json');
    const editor = page.locator('.json-schema-editor .cm-content');
    await expect(editor).toBeVisible();

    await editor.fill('{"properties":{"name":{"type":"strng"}}}');
    await expect(page.locator('.json-schema-editor .cm-lintRange-error')).toBeVisible();
    await editor.fill('{"type":"string"}');
    await expect(page.locator('.json-schema-editor .cm-lintRange-error')).toHaveCount(0);

    await editor.fill('{}');
    await editor.press('Home');
    await editor.press('ArrowRight');
    await editor.press('Control+Space');
    const options = page.locator('.cm-tooltip-autocomplete');
    await expect(options).toBeVisible();
    await expect(options.getByRole('option', { name: 'properties', exact: true })).toBeVisible();
    await editor.press('Escape');

    await editor.fill('{"type":""}');
    await editor.press('End');
    await editor.press('ArrowLeft');
    await editor.press('ArrowLeft');
    await editor.press('Control+Space');
    await expect(options).toBeVisible();
    await options.getByRole('option', { name: '"string"', exact: true }).click();
    await expect(editor).toHaveText('{"type":"string"}');
    await expect(page.locator('.json-schema-editor .cm-lintRange-error')).toHaveCount(0);
});
