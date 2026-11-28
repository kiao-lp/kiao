import { readFile } from 'node:fs/promises';
import { test, expect, workerApi } from '../harness';

/**
 * E2E: a diagram narrower than the preview column sits centered in it.
 *
 * Whatever language drew it — mermaid, plantuml, graph or svg, archdia
 * included — the picture is centered in its block rather than left-aligned.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/diagram-centering.md';

/** How far off-center a diagram may sit before it reads as left-aligned: subpixel rendering. */
const TOLERANCE_PX = 2;

/** How much narrower than its block a diagram must be for centering to mean anything. */
const MIN_SLACK_PX = 50;

const DIAGRAMS = [
    '.mermaid svg',
    'img[data-plantuml-source]',
    '.graph-viewer-artboard .graph-svg',
    '.svg-renderer-container svg',
    '.archdia-viewer-artboard .archdia-svg',
];

test('centers every diagram narrower than the preview column', async ({ page }) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    for (const selector of DIAGRAMS) {
        const diagram = page.locator(selector);
        await expect(diagram).toBeVisible({ timeout: TIMEOUT });

        const diagramBox = await diagram.boundingBox();
        const wrapperBox = await page
            .locator('.code-block-wrapper', { has: diagram })
            .boundingBox();
        expect(diagramBox, `${selector} has a box`).not.toBeNull();
        expect(wrapperBox, `${selector} sits in a block`).not.toBeNull();
        if (!diagramBox || !wrapperBox) continue;

        // Narrow first: a diagram as wide as its block is centered trivially.
        expect(wrapperBox.width - diagramBox.width, `${selector} is narrower than its block`)
            .toBeGreaterThan(MIN_SLACK_PX);

        const diagramCenter = diagramBox.x + diagramBox.width / 2;
        const wrapperCenter = wrapperBox.x + wrapperBox.width / 2;
        expect(Math.abs(diagramCenter - wrapperCenter), `${selector} is centered`)
            .toBeLessThanOrEqual(TOLERANCE_PX);
    }
});

test('an embedded graph zooms past the width it was fitted to', async ({ page }) => {
    await page.goto(FILE);
    const graph = page.locator('.graph-viewer-artboard');
    const canvas = graph.locator('.graph-viewer-canvas');
    const diagram = graph.locator('.graph-svg');
    const controls = graph.getByRole('group', { name: 'Diagram controls' });
    await expect(controls.getByRole('button', { name: 'Copy file' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Paste file' })).toHaveCount(0);
    await expect(controls.getByRole('button', { name: 'View Diagram' })).toHaveCount(0);
    await controls.getByRole('button', { name: 'Diagram size' }).click();
    await page.getByRole('button', { name: 'XL (1920×1080)' }).click();
    await expect(diagram).toHaveAttribute('width', '1920');
    const visibleWidth = await canvas.evaluate(element => element.clientWidth);
    const width = () => diagram.evaluate(svg => svg.getBoundingClientRect().width);
    expect(await width()).toBeCloseTo(visibleWidth, 0);

    await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
    await expect.poll(width).toBeCloseTo(visibleWidth * 1.1, 0);
    await expect.poll(() => canvas.evaluate(element => element.scrollWidth)).toBeGreaterThan(visibleWidth);
});

test('reveals block actions on keyboard focus and copies a short diagram', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/svg/*', route => route.fulfill({
        contentType: 'image/svg+xml',
        headers: { 'access-control-allow-origin': '*' },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="18"><rect width="120" height="18"/></svg>',
    }));
    await page.goto(FILE);

    const diagram = page.locator('img[data-plantuml-source]');
    await expect(diagram).toBeVisible();
    const block = page.locator('.code-block-wrapper', { has: diagram });
    const copySource = block.getByRole('button', { name: 'Copy code' });
    await copySource.focus();
    await expect(block.locator('.code-block-actions')).toHaveCSS('opacity', '1');
    await copySource.press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('@startuml\nstart\n:Se lever;\nstop\n@enduml');

    await block.getByRole('button', { name: 'Copy image' }).press('Enter');
    await block.getByRole('menuitem', { name: 'Copy as PNG' }).click();
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.read())[0]?.types))
        .toContain('image/png');
});

test('downloads the SVG from the selected embedded graph', async ({ page, request }) => {
    const path = 'smoke/graph-downloads.md';
    const graphBlock = (title: string) => [
        '```graph',
        JSON.stringify({ size: { width: 400, height: 300 }, nodes: [{ id: 'node', title, x: 40, y: 60 }], edges: [] }),
        '```',
    ].join('\n');
    const content = [graphBlock('First diagram'), graphBlock('Second diagram')].join('\n\n');
    const updated = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: 'graph-downloads.md', mimeType: 'text/markdown', buffer: Buffer.from(content) } },
    });
    expect(updated.ok()).toBeTruthy();

    await page.goto(path);
    const graphs = page.locator('.graph-viewer-artboard');
    await expect(graphs).toHaveCount(2);
    const ready = page.waitForEvent('download');
    await graphs.nth(1).getByRole('button', { name: 'Download SVG' }).click();
    const download = await ready;
    expect(await readFile(await download.path(), 'utf8')).toContain('Second diagram');
});
