import { test, expect, resetViewState } from '../harness';

test('zoom updates the drawing and keeps the SVG text editor over its shape', async ({ page }) => {
    await resetViewState();
    await page.goto('smoke/drawing.svg');
    const canvas = page.locator('.svg-edit');
    const drawing = canvas.locator('.svg-canvas');
    const label = drawing.getByText('Hello');
    const width = () => drawing.evaluate(svg => svg.getBoundingClientRect().width);
    const original = await width();

    await label.dblclick();
    const editor = canvas.locator('.svg-text-editor');
    await expect(editor).toHaveValue('Hello');
    await canvas.evaluate(element => {
        for (let step = 0; step < 2; step++) {
            element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true }));
        }
    });
    await expect.poll(width).toBeCloseTo(original * 1.2, 0);
    const text = (await label.boundingBox())!;
    const overlay = (await editor.boundingBox())!;
    expect(overlay.x).toBeCloseTo(text.x, 0);
    expect(overlay.y).toBeCloseTo(text.y, 0);

    await editor.press('Escape');
    await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
    await expect.poll(width).toBeCloseTo(original);
});
