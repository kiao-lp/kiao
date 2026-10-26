import { test, expect, workerApi } from '../harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E: a .glb opens on the 3D stage.
 *
 * The stage mounts before the model has finished downloading, and stays mounted if the
 * browser turns out to have no WebGL context to give it — so it is the honest selector here.
 *
 * The model is uploaded by the spec into `smoke/`, and taken away again: other specs list that
 * folder and the root of the store, and a fixture in the template would be in all of their
 * listings.
 */

const TIMEOUT = 15000;
const MODEL = 'smoke/cube.glb';
// Beside the spec rather than in the fixture template — the store must not seed it, the spec
// uploads it.
const MODEL_BYTES = readFileSync(join(__dirname, 'three-d-model-view/cube.glb'));

const BANNER = '.cms-top-banner';

test.describe('three-d-model-view', () => {
    test.beforeEach(async ({ request }) => {
        const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(MODEL)}`, {
            method: 'PUT',
            multipart: { file: { name: 'cube.glb', mimeType: 'model/gltf-binary', buffer: MODEL_BYTES } },
        });
        expect(response.ok(), `seeding ${MODEL}`).toBeTruthy();
    });

    test.afterEach(async ({ request }) => {
        await request.fetch(`${workerApi()}/delete?path=${encodeURIComponent(MODEL)}`, { method: 'DELETE' });
    });

    test('opens a .glb on the stage', async ({ page }) => {
        await page.goto(MODEL);
        await expect(page.locator(BANNER)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.model3d-stage')).toBeVisible({ timeout: TIMEOUT });
        await expect(page).toHaveTitle('cube.glb', { timeout: TIMEOUT });
    });
});
