import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

export type { APIRequestContext, Locator, Page, Response } from '@playwright/test';

// Each Playwright worker needs its own store and Dashboard: view state is app-wide.
// Keep port arithmetic in sync with bin/start-env.sh; stay below the Windows
// ephemeral range (49152+) to avoid WSL2 port reservations.

// Reserve two cores for the minimal stack, then two per shard to avoid timeout flakiness.
export const SHARDS = Number(process.env.E2E_SHARDS)
    || Math.min(6, Math.max(1, Math.floor((cpus().length - 2) / 2)));

export const workerPort = (shard: number) => 48310 + shard;
export const appPort = (shard: number) => 48332 + shard;

// The minimal-plugin assembly has a separate stack, shared with no other spec.
export const MINIMAL_WORKER_PORT = 48309;
export const MINIMAL_APP_PORT = 48350;
export const MINIMAL_APP = `http://localhost:${MINIMAL_APP_PORT}/dashboard`;

export const test = base.extend<{}, { shard: number; warmShard: void }>({
    shard: [async ({ }, use, workerInfo) => { await use(workerInfo.parallelIndex); }, { scope: 'worker' }],
    baseURL: async ({ shard }, use) => { await use(`http://localhost:${appPort(shard)}/dashboard/`); },
    // HTTP readiness serves only the shell; warm Vite once per worker before test deadlines apply.
    warmShard: [async ({ browser, shard }, use) => {
        const context = await browser.newContext({
            baseURL: `http://localhost:${appPort(shard)}/dashboard/`,
        });
        const page = await context.newPage();
        // A folder view loads the shared core with minimal overhead.
        await page.goto('works', { timeout: 60000 });
        await page.locator('.cms-top-banner').waitFor({ timeout: 60000 });
        await context.close();
        await use();
    }, { scope: 'worker', auto: true }],
});

export { expect };

export const workerApi = () => `http://localhost:${workerPort(test.info().parallelIndex)}`;

export const fileUrl = (path: string) => `${workerApi()}/getFile?path=${encodeURIComponent(path)}`;

// Playwright does not fire beforeunload on close, so flush the debounced view state explicitly.
// With nothing pending, no write occurs; return false after the 2s cap.
export const flushViewState = async (page: Page) => {
    const written = page.waitForResponse(
        response => response.request().method() === 'PUT' && response.url().includes('dashboard-view-state'),
        { timeout: 2000 },
    ).catch(() => null);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    return await written !== null;
};

// Specs within a worker share a store. Restore writable fixtures from the startup template
// so earlier specs cannot change their starting state.
export const restoreFixture = async (request: APIRequestContext, path: string) => {
    const buffer = readFileSync(resolve(__dirname, '../data/files-template', path));
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'application/octet-stream', buffer } },
    });
    expect(response.ok(), `restoring ${path}`).toBeTruthy();
};

/** Returns 0 if the file is absent. */
export const modifiedAt = async (request: APIRequestContext, path: string): Promise<number> => {
    const response = await request.fetch(`${workerApi()}/info?path=${encodeURIComponent(path)}`);
    if (!response.ok()) return 0;
    return (await response.json()).lastModified ?? 0;
};

// Wait for persistence before reloading; editor debounce delays may change.
export const awaitWrite = async (request: APIRequestContext, path: string, since: number) => {
    await expect.poll(() => modifiedAt(request, path), { timeout: 15000 }).toBeGreaterThan(since);
};

const VIEW_STATE_DOC = 'dashboard-view-state.json';

// Reset to defaults so app-wide layout changes cannot affect later specs.
export const resetViewState = async () => {
    const response = await fetch(`${workerApi()}/config/${VIEW_STATE_DOC}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, global: {}, folders: {}, files: {} }),
    });
    expect(response.ok, 'resetting the view state').toBeTruthy();
};
