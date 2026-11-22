import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

test('keeps a missing task agent reference and repairs it by reinstalling its Git repository', async ({ page, request }) => {
    test.setTimeout(120000);
    const base = `${workerApi()}/agentic-resources-api`;
    const api = async (path: string, method = 'GET', data?: unknown) => {
        const response = await request.fetch(base + path, { method, data, timeout: 60000 });
        expect(response.ok(), await response.text()).toBeTruthy();
        return response.status() === 204 ? undefined : response.json();
    };
    const agentId = crypto.randomUUID();
    const name = `Reinstall ${agentId}`;
    const stamp = { createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:00:00Z', revision: 1 };
    const repository = mkdtempSync(join(tmpdir(), 'kiao-agent-reinstall-'));
    try {
        const definitions = join(repository, '.apm', 'agents');
        mkdirSync(definitions, { recursive: true });
        writeFileSync(join(repository, 'agent.json'), JSON.stringify({ id: agentId, name, harness: 'codex', ...stamp }));
        writeFileSync(join(repository, 'apm.yml'), JSON.stringify({
            name: 'agent-reinstall', version: '1.0.0', description: name, targets: ['codex'],
        }));
        writeFileSync(join(definitions, 'agent-reinstall.agent.md'), [
            '---', 'name: agent-reinstall', 'description: Reinstall test agent', 'model: test-model',
            'model_reasoning_effort: high', '---', 'Keep this task.', '',
        ].join('\n'));
        const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' });
        git('init', '-b', 'main');
        git('add', '--all');
        git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'feat: agent fixture');
        git('tag', 'v1.0.0');
        expect((await api('/agents', 'POST', { repository })).id).toBe(agentId);
        const status = await api(`/agents/${agentId}/deletion`);
        await api(`/agents/${agentId}?confirmation=${status.confirmation}`, 'DELETE');
        const board = {
            board: { id: 'missing', slug: 'missing', name: 'Missing agent', archived: false, ...stamp },
            flowNodes: [{ id: 'task', type: 'ai', title: 'Repair the task', body: 'Keep this task.',
                settings: { agent: agentId, effort: 'high', permission: 'manual', folder: '/' }, spot: { x: 100, y: 100 }, ...stamp }],
            flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
        };
        await page.route('**/api/hybridflow/**', async route => {
            const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
            if (path === '/boards/missing') await route.fulfill({ json: board });
            else if (path === '/boards') await route.fulfill({ json: { boards: [board.board] } });
            else if (path === '/runners') await route.fulfill({ json: { runners: [] } });
            else if (path === '/changes') await route.fulfill({ status: 204 });
            else await route.fulfill({ status: 404 });
        });
        await page.goto('boards/missing');
        const card = page.getByTestId('flow-node-card');
        await expect(card.getByTestId('flow-node-card-invalid')).toBeVisible();
        await expect(card).not.toContainText('Missing agent');
        await card.dblclick();
        const panel = page.getByTestId('flow-node-panel');
        await panel.getByRole('tab', { name: 'Options', exact: true }).click();
        const diagnostic = panel.getByRole('alert').filter({ hasText: 'Missing agent' });
        await expect(diagnostic).toContainText(`Missing agent · ${agentId}`);
        await page.getByRole('button', { name: 'Reinstall agent…' }).click();
        const modal = page.getByRole('dialog', { name: 'Reinstall agent' });
        const install = async (source: string) => {
            await modal.getByRole('textbox', { name: 'Git repository URL or path' }).fill(source);
            const [response] = await Promise.all([
                page.waitForResponse(response => response.request().method() === 'POST'
                    && new URL(response.url()).pathname === '/api/agentic/agents'),
                modal.getByRole('button', { name: 'Reinstall' }).click(),
            ]);
            return response;
        };
        const empty = join(repository, 'empty.git');
        git('init', '--bare', '-b', 'main', empty);
        expect((await install(empty)).status()).toBe(400);
        expect(git('ls-remote', empty)).toHaveLength(0);
        const imported = await install(repository);
        expect(imported.ok(), await imported.text()).toBeTruthy();
        await expect(modal).not.toBeVisible({ timeout: 30000 });
        await expect(card).toContainText(name);
        await expect(card.getByTestId('flow-node-card-invalid')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Reinstall agent…' })).toHaveCount(0);
        expect((await api(`/agents/${agentId}`)).id).toBe(agentId);
        expect(board.flowNodes[0].settings.agent).toBe(agentId);
    } finally {
        const status = await request.get(`${base}/agents/${agentId}/deletion`);
        if (status.ok()) await api(`/agents/${agentId}?confirmation=${(await status.json()).confirmation}`, 'DELETE');
        rmSync(repository, { recursive: true, force: true });
    }
});
