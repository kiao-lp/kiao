import { test, expect, flushViewState, resetViewState } from '../harness';

test.describe('layout visibility', () => {
    test.afterEach(resetViewState);

    test('places the tools menu on the left, search in the middle, and visibility switches on the right', async ({ page }) => {
        await page.goto('');
        const banner = page.locator('.cms-top-banner');
        const menu = banner.getByRole('button', { name: 'Tools' });
        const search = banner.locator('.ant-input-affix-wrapper');
        const group = page.getByRole('group', { name: 'Layout visibility' });
        const ids = () => group.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')));
        await expect(group).toBeVisible();
        expect(await ids()).toEqual(['bar-toggle-left', 'bar-toggle-center-2', 'bar-toggle-right']);
        await expect(page.getByTestId('bar-toggle-center')).toHaveCount(0);

        for (const width of [1280, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 800 });
            const bar = (await banner.boundingBox())!;
            const tools = (await menu.boundingBox())!;
            const input = (await search.boundingBox())!;
            const switches = (await group.boundingBox())!;
            expect(tools.x - bar.x).toBeCloseTo(16, 0);
            expect(tools.x + tools.width).toBeLessThanOrEqual(input.x);
            expect(input.x + input.width / 2).toBeCloseTo(bar.x + bar.width / 2, 0);
            expect(switches.x + switches.width).toBeCloseTo(bar.x + bar.width - 16, 0);
        }

        await menu.click();
        await expect(page.getByRole('menuitem', { name: /Theme/ })).toBeVisible();
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
