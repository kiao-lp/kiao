import type { Route } from '@playwright/test';
import { test, expect, resetViewState, workerApi } from '../harness';
import { publishTestAgent, removeTestAgent } from '../conversationAgents';

test.afterEach(resetViewState);

test('renders the harness title and model names in the panel', async ({ page }) => {
    await page.route('**/hybridflow-runner/harness-models', route => route.fulfill({
        json: [{ value: 'codex', label: 'Codex' }],
    }));
    await page.route('**/hybridflow-runner/harness-models/codex', route => route.fulfill({
        json: {
            models: [{ value: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' }],
            activeModels: ['gpt-6.2-sol'], defaultModel: 'gpt-6.2-sol',
        },
    }));
    await page.goto('works');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Codex (harness)…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Codex (harness)' });
    const name = dialog.getByRole('rowheader', { name: /GPT-6\.2 Sol/ });
    await expect(name).toBeVisible();
    await expect(name).not.toHaveCSS('font-size', '0px');
    await expect(dialog.getByText('gpt-6.2-sol', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Codex (harness)', { exact: true })).toBeVisible();
});

test('keeps the conversation picker usable while the agent catalogue refreshes', async ({ page }) => {
    const published = {
        agentId: 'reviewer', name: 'Reviewer', harness: 'claude', model: 'haiku',
        version: '1.0.0', commit: 'a'.repeat(40),
    };
    const reviewer = { id: published.agentId, name: published.name, harness: published.harness, published };
    const reads: Route[] = [];
    const starts: Route[] = [];
    await page.clock.install();
    await page.route('**/api/agentic/agents', route => { reads.push(route); });
    await page.route('**/hybridflow-runner/conversations', route => {
        if (route.request().method() === 'POST') { starts.push(route); return; }
        return route.continue();
    });
    await page.route('**/hybridflow-runner/options', route => route.fulfill({ json: {
        harnesses: [{ value: 'claude', activeModels: ['haiku'] }],
    } }));

    await page.goto('works');
    if (!await page.getByTestId('tool-bar-side-right').count()) {
        await page.getByTestId('bar-toggle-right').click();
    }
    await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New conversation' });
    const loading = dialog.getByRole('status', { name: 'Loading agent and model options' });
    const choice = dialog.getByRole('button', { name: 'Reviewer · Claude Code / haiku' });
    await expect(loading).toBeVisible();
    await expect.poll(() => reads.length).toBe(1);
    await reads[0].fulfill({ json: { agents: [reviewer] } });
    await expect(choice).toBeVisible();

    await page.clock.fastForward(20_000);
    await expect.poll(() => reads.length).toBe(2);
    await choice.click({ trial: true, timeout: 5000 });
    await expect(loading).toHaveCount(0);

    await reads[1].fulfill({ json: { agents: [] } });
    const empty = dialog.getByText('Publish an agent in Agents.');
    await expect(empty).toBeVisible();
    await page.clock.fastForward(20_000);
    await expect.poll(() => reads.length).toBe(3);
    await expect(empty).toBeVisible();
    await expect(loading).toHaveCount(0);
    await reads[2].fulfill({ json: { agents: [reviewer] } });
    await expect(choice).toBeVisible();

    await choice.click();
    await expect(choice).toHaveAttribute('aria-busy', 'true');
    await expect(choice).toBeDisabled();
    await expect(dialog.getByText('Starting conversation…')).toBeVisible();
    await expect.poll(() => starts.length).toBe(1);
    await starts[0].fulfill({ status: 503, json: { error: 'Service unavailable' } });
    await expect(choice).toBeEnabled();
});

test('saves the active models and uses the chosen column for a conversation', async ({ page, request }) => {
    test.skip(process.env.E2E_CLAUDE_PERMISSIONS !== '1', 'requires the controlled Claude CLI fixture');
    const endpoint = `${workerApi()}/hybridflow-runner/harness-models/claude`;
    const initial = await request.get(endpoint);
    expect(initial.ok()).toBe(true);
    const { activeModels, defaultModel } = await initial.json();
    const agent = await publishTestAgent(request, { name: 'Model picker reviewer', harness: 'claude', model: 'opus' });
    const conversations = `${workerApi()}/hybridflow-runner/conversations`;
    let createdId: string | undefined;
    const openModels = async () => {
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Claude Code (harness)…' }).click();
        return page.getByTestId('harness-models-panel-claude');
    };
    try {
        await page.goto('works');
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Configuration…' }).click();
        await page.getByRole('button', { name: 'Configure Claude Code (harness)', exact: true }).click();
        const panel = page.getByTestId('harness-models-panel-claude');
        await expect(panel.getByRole('radio', { name: 'Use opus by default' })).toBeChecked();
        await expect(panel.getByRole('checkbox', { name: 'Activate fable' })).not.toBeChecked();
        await panel.getByRole('checkbox', { name: 'Activate fable' }).click();
        await panel.getByRole('radio', { name: 'Use fable by default' }).click();
        await panel.getByRole('checkbox', { name: 'Activate opus' }).click();
        await expect.poll(async () => (await request.get(endpoint)).json()).toMatchObject({
            activeModels: ['sonnet', 'haiku', 'fable'], defaultModel: 'fable',
        });

        await page.reload();
        const reopened = await openModels();
        await expect(reopened.getByRole('radio', { name: 'Use fable by default' })).toBeChecked();
        await expect(reopened.getByRole('checkbox', { name: 'Activate opus' })).not.toBeChecked();
        if (!await page.getByTestId('tool-bar-side-right').count()) {
            await page.getByTestId('bar-toggle-right').click();
        }
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.getByRole('button', { name: 'New conversation', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New conversation' });
        await expect(dialog.getByRole('columnheader', { name: 'Claude Code / fable' })).toBeVisible();
        await expect(dialog.getByRole('columnheader', { name: 'Claude Code / opus' })).toHaveCount(0);
        const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/hybridflow-runner/conversations'));
        await dialog.getByRole('button', { name: `${agent.name} · Claude Code / haiku` }).click();
        const created = await response;
        expect(created.status(), await created.text()).toBe(201);
        const conversation = await created.json();
        createdId = conversation.id;
        expect(conversation).toMatchObject({
            harness: 'claude', model: 'haiku', agentVersion: { agentId: agent.id, model: 'opus', resolvedModel: 'haiku' },
        });
    } finally {
        if (createdId) await request.delete(`${conversations}/${createdId}`);
        await removeTestAgent(request, agent.id);
        await request.put(endpoint, { data: { activeModels, defaultModel } });
    }
});

test('persists the selected model on a task and reselects its column', async ({ page, request }) => {
    test.skip(process.env.E2E_CLAUDE_PERMISSIONS !== '1', 'requires the controlled Claude CLI fixture');
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');
    const agent = await publishTestAgent(request, { name: 'Task model reviewer', harness: 'claude', model: 'opus' });
    const boards = `${workerApi()}/hybridflow-runner/boards`;
    let boardPath: string | undefined;
    try {
        const created = await request.post(boards, { data: { name: 'Task model selection' } });
        expect(created.ok(), await created.text()).toBe(true);
        const { board } = await created.json();
        boardPath = `${boards}/${board.slug}`;
        const id = crypto.randomUUID();
        const node = await request.post(`${boardPath}/flow-nodes`, { data: { flowNodes: [{
            id, title: 'Review the result', type: 'ai', body: 'Review the proposed change.', spot: { x: 100, y: 100 },
            settings: { agent: agent.id, effort: 'low', permission: 'bypassPermissions', folder: '/' },
        }] } });
        expect(node.ok(), await node.text()).toBe(true);
        await page.goto(`boards/${board.slug}`);
        await page.getByTestId('flow-node-card').dblclick();
        await page.getByTestId('flow-node-panel').getByRole('tab', { name: 'Options', exact: true }).click();
        const picker = page.getByTestId('flow-node-agent');
        await picker.click();
        const dialog = page.getByRole('dialog', { name: 'Choose agent and harness' });
        const sonnet = dialog.getByRole('button', { name: `${agent.name} · Claude Code / sonnet` });
        await sonnet.click();
        await expect(picker).toContainText('sonnet');
        await expect.poll(async () => {
            const response = await request.get(`${boardPath}/flow-nodes/${id}`);
            return (await response.json()).settings;
        }).toMatchObject({ agent: agent.id, harness: 'claude', model: 'sonnet' });
        await picker.click();
        await expect(sonnet).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByRole('button', { name: `${agent.name} · Claude Code / opus` })).toHaveAttribute('aria-pressed', 'false');
    } finally {
        if (boardPath) await request.delete(boardPath);
        await removeTestAgent(request, agent.id);
    }
});
