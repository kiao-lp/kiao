import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, resetViewState, showMarkdownEditor, workerApi } from '../harness';
import { removeTestAgent } from '../conversationAgents';

test.afterEach(resetViewState);

test('runs an unpublished agent and confirms a push with a local dependency', async ({ page, request }) => {
    test.setTimeout(60000);
    const scratch = mkdtempSync(join(tmpdir(), 'kiao-draft-agent-'));
    const repository = join(scratch, 'agent-preview.git');
    const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    const endpoint = `${workerApi()}/agentic-resources-api`;
    const conversations = `${workerApi()}/hybridflow-runner/conversations`;
    const name = `Local preview ${crypto.randomUUID()}`;
    let agentId: string | undefined;
    let chatId: string | undefined;
    try {
        git(scratch, 'init', '--bare', '-b', 'main', repository);
        const created = await request.post(`${endpoint}/agents`, {
            data: { repository, name, harness: 'claude', model: 'haiku', effort: 'high', instructions: 'Draft instructions.' },
        });
        expect(created.ok(), await created.text()).toBe(true);
        agentId = (await created.json()).id;
        const agentUrl = `${endpoint}/agents/${agentId}`;

        await page.goto('works');
        await page.locator('.cms-top-banner .anticon-more').click();
        await page.getByRole('menuitem', { name: /Agents…$/ }).click();
        const row = page.getByTestId('agent-card').filter({ hasText: name });
        await row.getByTestId('edit-agent').click();
        const editor = page.getByTestId('agent-editor');
        const picker = editor.getByRole('combobox', { name: 'Link an MCP module' });
        await picker.fill('package-proof');
        await page.locator('.ant-select-dropdown:visible').getByText('package-proof', { exact: true }).click();
        const linked = editor.getByRole('table', { name: 'Linked MCP modules' });
        await expect(linked.getByRole('columnheader', { name: 'Local' })).toBeVisible();
        await expect(linked.getByRole('img', { name: /not backed up/ })).toBeVisible();
        const skill = editor.getByRole('combobox', { name: 'Link a skill' });
        await skill.fill('review-checklist');
        await page.locator('.ant-select-dropdown:visible').getByText('review-checklist', { exact: true }).click();
        await expect(editor.getByRole('button', { name: 'Unlink review-checklist' })).toBeVisible();

        const right = page.getByTestId('tool-bar-side-right');
        if (await right.count() === 0) await page.getByTestId('bar-toggle-right').click();
        await right.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.getByRole('button', { name: 'New conversation', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New conversation' });
        await dialog.getByRole('checkbox', { name: 'Use local draft' }).check();
        const [chat] = await Promise.all([
            page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname.endsWith('/hybridflow-runner/conversations')),
            dialog.getByRole('button', { name: `${name} · Claude Code` }).click(),
        ]);
        expect(chat.status(), await chat.text()).toBe(201);
        const conversation = await chat.json();
        chatId = conversation.id;
        expect(conversation.agentVersion).toMatchObject({ agentId, draftId: expect.any(String), instructions: 'Draft instructions.' });
        expect(conversation.agentVersion.commit).toBeUndefined();
        await expect(page.getByTestId('conversation-agent-version')).toContainText('Local draft');
        await expect(page.locator('.chat-textarea')).toBeEnabled();

        const publish = editor.getByRole('button', { name: 'Publish major v1.0.0' });
        const warning = page.getByRole('dialog').filter({ hasText: 'Push an agent that requires Kiao?' });
        await publish.click();
        await expect(warning).toContainText('mcp-package-proof');
        await warning.getByRole('button', { name: 'Cancel' }).click();
        await expect(warning).toBeHidden();
        expect(git(repository, 'tag', '--list')).toBe('');
        expect((await (await request.get(agentUrl)).json()).published).toBeUndefined();
        await publish.click();
        await warning.getByRole('button', { name: 'Push to Git', exact: true }).click();
        await expect(row).toContainText('Published v1.0.0', { timeout: 30000 });
        expect(git(repository, 'tag', '--list')).toBe('v1.0.0');
        expect(git(repository, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.agents/skills', '.claude/skills')).toBe('');
        expect(git(repository, 'show', 'HEAD:apm.lock.yaml')).toContain('review-checklist/SKILL.md');
    } finally {
        if (chatId) await request.delete(`${conversations}/${chatId}`);
        if (agentId) await removeTestAgent(request, agentId);
        rmSync(scratch, { recursive: true, force: true });
    }
});

test('publishes an agent edited from DCMS and confirms deletion of its clone', async ({ page, request }) => {
    const endpoint = () => `${workerApi()}/agentic-resources-api`;
    const api = async (path: string, method = 'GET', data?: unknown) => {
        const response = await request.fetch(`${endpoint()}${path}`, { method, data, timeout: 120000 });
        expect(response.ok(), await response.text()).toBeTruthy();
        return response.status() === 204 ? undefined : response.json();
    };
    const name = `Publication ${crypto.randomUUID()}`;
    const agent = await api('/agents', 'POST', { name, harness: 'codex', model: 'test-model', effort: 'high' });
    try {
        await page.goto('');
        await expect(page.getByTestId('browser-item-agentic-resource-management')).toBeVisible();
        await page.goto(`agentic-resource-management/agents/${agent.repository}/.apm/agents/${agent.repository}.agent.md`);
        await showMarkdownEditor(page);
        const source = page.locator('.cm-content').first();
        await expect(source).toContainText(`name: ${agent.repository}`);
        await source.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.insertText('First published orders.');
        await expect.poll(async () => (await api(`/agents/${agent.id}`)).instructions, { timeout: 15000 }).toBe('First published orders.');

        await page.goto('works');
        await page.locator('.cms-top-banner .anticon-more').click();
        await page.getByRole('menuitem', { name: /Agents…$/ }).click();
        const row = page.getByTestId('agent-card').filter({ hasText: name });
        await expect(row).toContainText('Unpublished');
        await row.getByTestId('edit-agent').click();
        const editor = page.getByTestId('agent-editor');
        await expect(editor.getByRole('button', { name: 'Publish minor v0.1.0' })).toBeEnabled();
        await expect(editor.getByRole('button', { name: 'Publish patch v0.0.1' })).toBeEnabled();
        await editor.getByRole('button', { name: 'Publish major v1.0.0' }).click();
        await expect(row).toContainText('Published v1.0.0', { timeout: 30000 });
        await expect(editor.getByRole('button', { name: 'Publish patch v1.0.1' })).toBeDisabled();
        expect((await request.post(`${endpoint()}/agents/${agent.id}/publish`)).status()).toBe(409);
        await editor.getByTestId('agent-instructions').fill('Second published orders.');
        await expect.poll(async () => (await api(`/agents/${agent.id}`)).instructions).toBe('Second published orders.');
        expect((await api(`/agents/${agent.id}`)).published.instructions).toBe('First published orders.');
        await editor.getByRole('button', { name: 'Publish patch v1.0.1' }).click();
        await expect(row).toContainText('Published v1.0.1', { timeout: 30000 });
        await editor.getByTestId('agent-instructions').fill('Third published orders.');
        await expect.poll(async () => (await api(`/agents/${agent.id}`)).instructions).toBe('Third published orders.');
        await editor.getByRole('button', { name: 'Publish minor v1.1.0' }).click();
        await expect(row).toContainText('Published v1.1.0', { timeout: 30000 });
        const versions = (await api(`/agents/${agent.id}/versions`)).versions;
        expect(versions.map((one: any) => [one.version, one.instructions])).toEqual([
            ['1.0.0', 'First published orders.'], ['1.0.1', 'Second published orders.'], ['1.1.0', 'Third published orders.'],
        ]);
        expect(versions.every((one: any) => /^[0-9a-f]{40}$/.test(one.commit))).toBeTruthy();
        expect(versions.map((one: any) => one.tag)).toEqual(['v1.0.0', 'v1.0.1', 'v1.1.0']);
        const bundle = await api(`/agents/${agent.id}/packages/${versions[1].commit}`);
        expect(bundle.files[`${bundle.project}/apm.lock.yaml`]).toBeTruthy();
        await editor.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: 'Agent version', exact: true }) }).click();
        const firstPublication = page.locator('.ant-select-dropdown:visible').getByText('Published v1.0.0', { exact: true });
        await expect(firstPublication).toBeVisible();
        await firstPublication.click();
        await expect(editor.getByTestId('agent-publication')).toContainText('First published orders.');
        await page.getByTestId('central-panel-agent-editor-close').click();
        await row.getByTestId('delete-agent').click();
        const confirmation = page.getByRole('dialog').filter({ hasText: `Delete ${name}?` });
        await expect(confirmation).toContainText('no remote');
        await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(row).toHaveCount(0);
        expect((await request.get(`${endpoint()}/agents/${agent.id}`)).status()).toBe(404);
    } finally {
        const status = await request.get(`${endpoint()}/agents/${agent.id}/deletion`);
        if (status.ok()) await api(`/agents/${agent.id}?confirmation=${(await status.json()).confirmation}`, 'DELETE');
    }
});

test('publishes a skill and an MCP module from their APM versions', async ({ page }) => {
    await page.goto('works');
    await page.locator('.cms-top-banner .anticon-more').click();
    await page.getByRole('menuitem', { name: /Agentic resources…$/ }).click();
    const resource = page.getByRole('combobox', { name: 'Agentic resource', exact: true });
    const source = page.getByRole('textbox', { name: 'Resource source' });
    const cases = [
        { name: 'skill-review-checklist', action: 'Publish minor', version: '1.1.0' },
        { name: 'mcp-package-proof', action: 'Publish major', version: '2.0.0' },
    ];
    for (const { name, action, version } of cases) {
        await resource.click();
        await page.locator('.ant-select-dropdown:visible').getByText(`${name} · v1.0.0`, { exact: true }).click();
        await expect(source).toBeEnabled();
        await page.getByRole('button', { name: action, exact: true }).click();
        await expect(source).toBeEnabled();
        await expect(source).toHaveValue(new RegExp(`version: ['"]?${version.replaceAll('.', '\\.')}`));
        await expect(page.getByText(`${name} · v${version}`, { exact: true })).toBeVisible();
    }
});

const dependencies = [
    {
        label: 'Skills', picker: 'Link a skill', option: 'review-checklist', search: 'checklist',
        isDeployed: (files: Record<string, string>) => Boolean(files['deployment/.agents/skills/skill-review-checklist/SKILL.md']),
    },
    {
        label: 'MCP modules', picker: 'Link an MCP module', option: 'package-proof', search: 'proof',
        isDeployed: (files: Record<string, string>) => {
            const config = files['deployment/.mcp.json'];
            return !!config && Boolean(JSON.parse(Buffer.from(config, 'base64').toString('utf8')).mcpServers?.['package-proof']);
        },
    },
];

for (const dependency of dependencies) {
    test(`links and unlinks ${dependency.label} through the agent editor`, async ({ page, request }) => {
        const endpoint = `${workerApi()}/agentic-resources-api`;
        const name = `${dependency.label} ${crypto.randomUUID()}`;
        const created = await request.post(`${endpoint}/agents`, {
            data: { name, harness: 'codex', model: 'test-model', effort: 'high' },
        });
        expect(created.ok(), await created.text()).toBeTruthy();
        const { id } = await created.json();
        const agentUrl = `${endpoint}/agents/${id}`;
        try {
            await page.goto('works');
            await page.locator('.cms-top-banner .anticon-more').click();
            await page.getByRole('menuitem', { name: /Agents…$/ }).click();
            const row = page.getByTestId('agent-card').filter({ hasText: name });
            const edit = row.getByTestId('edit-agent');
            await edit.click();
            const editor = page.getByTestId('agent-editor');
            const section = editor.getByRole('region', { name: dependency.label });
            const empty = section.getByText(/^No .+ linked\.$/);
            await expect(empty).toBeVisible();
            const picker = section.getByRole('combobox', { name: dependency.picker });
            await picker.fill(dependency.search);
            await expect(page.locator('.ant-select-dropdown:visible').getByText(dependency.option, { exact: true })).toBeVisible();
            await picker.press('Enter');
            const unlink = section.getByRole('button', { name: `Unlink ${dependency.option}` });
            await expect(unlink).toBeVisible();

            const publish = async (bump: 'major' | 'patch', version: string) => {
                await editor.getByRole('button', { name: `Publish ${bump} v${version}` }).click();
                await expect(row).toContainText(`Published v${version}`, { timeout: 30000 });
                const draft = await (await request.get(agentUrl)).json();
                const bundle = await request.get(`${agentUrl}/packages/${draft.published.commit}`);
                expect(bundle.ok(), await bundle.text()).toBeTruthy();
                return (await bundle.json()).files;
            };
            expect(dependency.isDeployed(await publish('major', '1.0.0'))).toBe(true);

            const close = page.getByTestId('central-panel-agent-editor-close');
            await close.click();
            await edit.click();
            await expect(editor.getByRole('button', { name: 'Publish patch v1.0.1' })).toBeDisabled();
            await unlink.click();
            await expect(empty).toBeVisible();
            expect(dependency.isDeployed(await publish('patch', '1.0.1'))).toBe(false);
        } finally {
            const status = await request.get(`${agentUrl}/deletion`);
            if (status.ok()) await request.delete(`${agentUrl}?confirmation=${(await status.json()).confirmation}`);
        }
    });
}
