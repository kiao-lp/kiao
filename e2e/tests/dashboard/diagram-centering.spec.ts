import { test, expect } from '../harness';

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
