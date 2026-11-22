import { test, expect, flushViewState, resetViewState } from '../harness';

test.describe('layout visibility', () => {
    test.afterEach(resetViewState);

    test('groups the switches before the tools menu, with no switch for the first central area', async ({ page }) => {
        await page.goto('');
        const group = page.getByRole('group', { name: 'Layout visibility' });
        const ids = () => group.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')));
        await expect(group).toBeVisible();
        expect(await ids()).toEqual(['bar-toggle-left', 'bar-toggle-center-2', 'bar-toggle-right']);
        await expect(page.getByTestId('bar-toggle-center')).toHaveCount(0);
        const bounds = (await group.boundingBox())!;
        const menu = (await page.locator('.cms-top-banner .anticon-more').boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(menu.x);
    });

    test('switches the second central area, keeping the first one and the split proportions', async ({ page }) => {
        await page.goto('');
        const first = page.getByTestId('tool-bar-center');
        const second = page.getByTestId('tool-bar-center-2');
        await expect(first).toBeVisible();
        await expect(second).toHaveCount(0);
        await expect(page.getByTestId('bar-toggle-center-2')).toHaveAccessibleName('Show the second central area');

        await page.getByTestId('bar-toggle-center-2').click();
        await expect(second).toBeVisible();
        await expect(page.getByTestId('bar-toggle-center-2')).toHaveAccessibleName('Hide the second central area');
        const firstWidth = (await first.boundingBox())!.width;
        const secondWidth = (await second.boundingBox())!.width;

        await page.getByTestId('bar-toggle-center-2').click();
        await expect(second).toHaveCount(0);
        await expect(first).toBeVisible();
        await expect(page.getByTestId('split-resize-center-2')).toHaveCount(0);
        await flushViewState(page);
        await page.reload();
        await expect(page.getByTestId('tool-bar-center-2')).toHaveCount(0);
        await expect(page.getByTestId('bar-toggle-center-2')).toHaveAccessibleName('Show the second central area');
        await expect(first).toBeVisible();

        await page.getByTestId('bar-toggle-center-2').click();
        await expect(second).toBeVisible();
        expect((await first.boundingBox())!.width).toBeCloseTo(firstWidth, 0);
        expect((await second.boundingBox())!.width).toBeCloseTo(secondWidth, 0);
        await expect(page.getByTestId('split-resize-center-2')).toBeVisible();
    });
});
