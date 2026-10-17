import { defineConfig, devices } from '@playwright/test';
import { basename, resolve } from 'node:path';
import { lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { MINIMAL_APP_PORT, SHARDS, appPort } from './tests/harness';

// Bypass proxies: a proxy 403 passes Playwright readiness and prevents the stack from starting.
const noProxyHosts = 'localhost,127.0.0.1';
process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${noProxyHosts}` : noProxyHosts;
process.env.no_proxy = process.env.NO_PROXY;

/** Plugin paths resolve against Dashboard, as in its build; start-env.sh seeds their fixtures. */
export const droppedPlugins = (process.env.VITE_PLUGIN_PATHS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(path => resolve(__dirname, '../exchange/dashboard', path))
    .filter(dir => lendModules(resolve(dir, 'e2e')) !== false);

// Dropped plugin specs use @playwright/test directly, so they can only target one stack.
const shards = droppedPlugins.length > 0 ? 1 : SHARDS;

// These stacks have no boards backend. Never register their runners with a service
// or credentials inherited from the developer's shell.
const stackEnv = { KIAO_WORKER_HYBRIDFLOW_URL: '', KIAO_WORKER_HYBRIDFLOW_TOKEN: '' };

/**
 * Lend harness dependencies: Node resolution from a dropped spec cannot reach this node_modules.
 * Return false if the plugin has no e2e directory; preserve real dependency directories.
 */
function lendModules(dir: string) {
    const target = resolve(__dirname, 'node_modules');
    const link = resolve(dir, 'node_modules');
    let current;
    try { current = lstatSync(dir); } catch { return false; }
    if (!current.isDirectory()) return false;
    try { current = lstatSync(link); } catch { current = null; }
    if (current && !current.isSymbolicLink()) return true;
    if (current && readlinkSync(link) === target) return true;
    if (current) unlinkSync(link);
    symlinkSync(target, link, 'junction');
    return true;
}

export default defineConfig({
    testDir: './tests',
    /* Some files contain sequential tests; independent files can opt into parallel mode. */
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    /* Produce a report on timeout; run-tests.sh also bounds a stuck Playwright process. */
    globalTimeout: Number(process.env.E2E_GLOBAL_TIMEOUT_MS) || 25 * 60 * 1000,
    /* Allow for concurrent stacks and Vite compiling routes on first navigation. */
    timeout: 60 * 1000,
    expect: { timeout: 10 * 1000 },
    /* Each Playwright worker has a backend worker and store to isolate view-state writes. */
    workers: shards,
    /* JSON feeds bin/summarise-run.mjs and stays outside outputDir, which Playwright clears.
     * Disable HTML auto-open so unattended runs cannot block serving a report. */
    reporter: [
        ['list'],
        ['json', { outputFile: '../log/e2e-results.json' }],
        ['html', { open: 'never' }],
    ],
    use: {
        /* Dropped specs use shard 0; tests/harness.ts assigns other specs their worker's stack. */
        baseURL: `http://localhost:${appPort(0)}/dashboard/`,

        trace: 'on-first-retry',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        ...droppedPlugins.map(dir => ({
            name: `chromium:${basename(dir)}`,
            testDir: resolve(dir, 'e2e'),
            use: { ...devices['Desktop Chrome'] },
        })),
    ],

    /* One stack per Playwright worker, plus the minimal assembly. */
    webServer: [
        ...Array.from({ length: shards }, (_, shard) => ({
            command: `bin/start-env.sh ${shard}`,
            url: `http://localhost:${appPort(shard)}/dashboard/`,
            reuseExistingServer: !process.env.CI,
            timeout: 180 * 1000,
            cwd: '.',
            env: stackEnv,
            // SIGTERM lets start-env.sh clean up temp data and services; default SIGKILL skips its trap.
            gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 15 * 1000 },
        })),
        {
            // Dedicated three-plugin stack for minimal-assembly.spec.ts.
            command: 'bin/start-minimal-assembly.sh',
            url: `http://localhost:${MINIMAL_APP_PORT}/dashboard/`,
            reuseExistingServer: !process.env.CI,
            timeout: 180 * 1000,
            cwd: '.',
            env: stackEnv,
            gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 15 * 1000 },
        },
    ],
});
