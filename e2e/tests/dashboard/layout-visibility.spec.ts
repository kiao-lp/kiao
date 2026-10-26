import { test, expect, Page, flushViewState, resetViewState } from '../harness';

const chooseCentralCount = async (page: Page, count: 1 | 2) => {
    await page.locator('.cms-top-banner .anticon-more').click();
    await page.getByText('Show', { exact: true }).hover();
    await page.getByText('Central areas', { exact: true }).hover();
    await page.getByTestId(`show-central-count-${count}`).click();
    await page.keyboard.press('Escape');
};

test.describe('layout visibility', () => {
    test.afterEach(resetViewState);

    test('groups the switches before the tools menu and follows the configured area count', async ({ page }) => {
        await page.goto('');
        const group = page.getByRole('group', { name: 'Layout visibility' });
        const ids = () => group.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')));
        await expect(group).toBeVisible();
        expect(await ids()).toEqual(['bar-toggle-left', 'bar-toggle-center', 'bar-toggle-right']);
        const bounds = (await group.boundingBox())!;
        const menu = (await page.locator('.cms-top-banner .anticon-more').boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(menu.x);

        await chooseCentralCount(page, 2);
        expect(await ids()).toEqual(['bar-toggle-left', 'bar-toggle-center', 'bar-toggle-center-2', 'bar-toggle-right']);

        await chooseCentralCount(page, 1);
        await expect(page.getByTestId('bar-toggle-center-2')).toHaveCount(0);
    });

    test('hides areas independently, preserves their count and restores their widths', async ({ page }) => {
        await page.goto('');
        await expect(page.getByTestId('bar-toggle-center')).toBeVisible();
        await chooseCentralCount(page, 2);
        const first = page.getByTestId('tool-bar-center');
        const second = page.getByTestId('tool-bar-center-2');
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        const firstWidth = (await first.boundingBox())!.width;
        const secondWidth = (await second.boundingBox())!.width;

        await page.getByTestId('bar-toggle-center').click();
        await expect(first).toBeHidden();
        await expect(second).toBeVisible();
        expect((await second.boundingBox())!.width).toBeGreaterThan(secondWidth);
        await expect(page.getByTestId('split-resize-center-2')).toHaveCount(0);

        await page.getByTestId('bar-toggle-center-2').click();
        await expect(second).toBeHidden();
        await flushViewState(page);
        await page.reload();
        await expect(page.getByTestId('bar-toggle-center')).toHaveAccessibleName('Show the first central area');
        await expect(page.getByTestId('bar-toggle-center-2')).toHaveAccessibleName('Show the second central area');
        await expect(first).toBeHidden();
        await expect(second).toBeHidden();

        await page.locator('.cms-top-banner .anticon-more').click();
        await page.getByText('Show', { exact: true }).hover();
        await page.getByText('Central areas', { exact: true }).hover();
        await expect(page.getByTestId('show-central-count-2')).toHaveText('✓ 2 areas');
        await page.keyboard.press('Escape');

        await page.getByTestId('bar-toggle-center').click();
        await page.getByTestId('bar-toggle-center-2').click();
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        expect((await first.boundingBox())!.width).toBeCloseTo(firstWidth, 0);
        expect((await second.boundingBox())!.width).toBeCloseTo(secondWidth, 0);
        await expect(page.getByTestId('split-resize-center-2')).toBeVisible();
    });
});
