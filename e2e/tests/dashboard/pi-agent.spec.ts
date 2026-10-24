import { resolve } from 'node:path';
import { test, expect, workerApi, resetViewState, flushViewState, Page } from '../harness';

const api = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${workerApi()}/hybridflow-runner${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.ok, await response.clone().text()).toBeTruthy();
    return response.status === 204 ? null : response.json();
};
const fakePi = resolve(__dirname, '../../../operation/worker/internal/hybridflow-runner/agents/pi/testdata/fake-pi.mjs');
const profile = (id: string, name: string, provider: string) => ({
    id, name, revision: 0, installationId: 'fixture', defaultModel: `${provider}/shared-model`, defaultEffort: 'off', mcpServers: null,
    connections: [{ provider, api: 'openai-completions', baseUrl: `http://127.0.0.1/${id}/v1`, secretRef: `private:${id}`,
        models: [{ id: 'shared-model', reasoning: true, input: ['text', 'image'], contextWindow: 10000, maxTokens: 1024 }] }],
});
const seed = async () => {
    await api('/profile-secrets/pi-a', 'PUT', { value: 'fixture-key-A' });
    await api('/profile-secrets/pi-b', 'PUT', { value: 'fixture-key-B' });
    await api('/profiles', 'PUT', { version: 1, installations: [{ id: 'fixture', engine: 'pi', version: '1.3.0', path: fakePi, protocol: 'pi-rpc-1.3', external: true }],
        profiles: [profile('pi-a', 'Pi account A', 'openai'), profile('pi-b', 'Pi account B', 'deepseek')] });
};
const tab = async (page: Page, name: string) => {
    await expect(page.locator('.cms-top-banner')).toBeVisible();
    if (await page.getByTestId('tool-bar-side-right').count() === 0) await page.getByTestId('bar-toggle-right').click();
    await page.getByRole('tab', { name, exact: true }).click();
    await page.mouse.move(0, 0);
};
const choose = async (page: Page, label: string, text: string) => {
    await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click();
    await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();
};

test.afterEach(resetViewState);

test('configures reusable Pi connections and diagnoses model capabilities', async ({ page }, testInfo) => {
    await api('/profiles', 'PUT', { version: 1, profiles: [], installations: [{ id: 'fixture', engine: 'pi', version: '1.3.0', path: fakePi, protocol: 'pi-rpc-1.3', external: true }] });
    await page.goto('works'); await tab(page, 'Configuration');
    await expect(page.getByTestId('toolbox-panel').getByTestId('agent-profiles-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Pi profiles…', exact: true }).click();
    const panel = page.getByTestId('agent-profiles-panel');
    await expect(page.getByTestId('tool-bar-side-center').getByTestId('agent-profiles-panel')).toBeVisible();
    for (const [name, provider] of [['Pi multi-provider', 'openai'], ['Pi second account', 'openai']]) {
        await panel.getByRole('button', { name: 'New profile', exact: true }).click();
        await panel.getByLabel('Profile name', { exact: true }).fill(name);
        await panel.getByRole('button', { name: 'Add connection', exact: true }).click();
        await panel.getByLabel('Provider 1', { exact: true }).fill(provider);
        await panel.getByLabel('Endpoint 1', { exact: true }).fill('http://127.0.0.1:1/v1');
        await panel.getByRole('button', { name: 'Add model', exact: true }).click();
        await panel.getByLabel('Model 1.1', { exact: true }).fill('shared-model');
        await expect(panel.getByRole('radio', { name: 'Use by default', exact: true }).first()).toBeChecked();
        if (name === 'Pi multi-provider') {
            await panel.getByRole('button', { name: 'Add connection', exact: true }).click();
            await panel.getByLabel('Provider 2', { exact: true }).fill('deepseek');
            await panel.getByLabel('Endpoint 2', { exact: true }).fill('http://127.0.0.2:1/v1');
            await panel.getByRole('button', { name: 'Add model', exact: true }).last().click();
            await panel.getByLabel('Model 2.1', { exact: true }).fill('deepseek-chat');
        }
        await expect.poll(async () => (await api('/profiles')).profiles.find((one: any) => one.name === name)?.defaultModel).toBe('openai/shared-model');
    }
    const state = await api('/profiles');
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0].connections.map((one: any) => one.provider)).toEqual(['openai', 'deepseek']);
    await panel.getByRole('button', { name: 'Add API key', exact: true }).click();
    await panel.getByLabel('Private key reference', { exact: true }).fill('ui-key');
    await panel.getByLabel('Private API key', { exact: true }).fill('fixture-ui-key');
    await panel.getByRole('button', { name: 'Store key', exact: true }).click();
    await expect(panel.getByText('Key available', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Check models', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('1 configured model recognised by Pi');
    await expect(panel.getByRole('status')).toContainText('openai/shared-model');
    await panel.evaluate(element => element.parentElement!.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('pi-profiles.png') });
    await choose(page, 'Default reasoning level', 'Off');
    await expect(panel.getByRole('combobox', { name: 'Default reasoning level', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Test API connection', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('API connection succeeded for openai/shared-model');

    await panel.getByRole('tab', { name: /API keys/ }).click();
    const stored = panel.getByTestId('private-key-ui-key');
    await expect(stored).toContainText('Pi second account / openai');
    await expect(stored).not.toContainText('fixture-ui-key');
    await page.screenshot({ path: testInfo.outputPath('pi-api-keys.png') });
    await stored.getByRole('button', { name: 'Show key', exact: true }).click();
    await expect(stored).toContainText('fixture-ui-key');
    await stored.getByRole('button', { name: 'Hide key', exact: true }).click();
    await expect(stored).not.toContainText('fixture-ui-key');
    await stored.getByRole('button', { name: 'Remove key', exact: true }).click();
    await expect(stored).toHaveCount(0);
    await panel.getByRole('tab', { name: 'Profiles', exact: true }).click();
    await expect(panel.getByText('Key missing', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Check models', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('API key private:ui-key');
    await page.setViewportSize({ width: 720, height: 900 });
    await panel.evaluate(element => element.parentElement!.scrollTo(0, 0));
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('pi-profiles-narrow.png') });
});

test('explains empty models, invalid drafts and a request URL used as the base URL', async ({ page }) => {
    await seed();
    const doc = await api('/profiles');
    await api('/profiles', 'PUT', { version: 1, installations: doc.installations, profiles: [{ ...profile('empty', 'Empty profile', 'deepseek'), defaultModel: '', connections: [] }] });
    await page.goto('works');
    await page.getByRole('tab', { name: 'Pi profiles', exact: true }).click();
    const panel = page.getByTestId('agent-profiles-panel');
    let checks = 0;
    page.on('request', request => { if (request.url().endsWith('/diagnostic')) checks++; });
    await panel.getByRole('button', { name: 'Check models', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('No models are configured. Add a model ID');
    await panel.getByRole('button', { name: 'Add connection', exact: true }).click();
    await panel.getByRole('button', { name: 'Check models', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('Your changes could not be saved');
    expect(checks).toBe(0);
    await panel.getByLabel('Provider 1', { exact: true }).fill('deepseek');
    await panel.getByLabel('Endpoint 1', { exact: true }).fill('https://api.deepseek.com/chat/completions');
    await expect(panel.getByText(/Pi adds \/chat\/completions itself/)).toBeVisible();
    await panel.getByRole('button', { name: 'Use base URL', exact: true }).click();
    await expect(panel.getByLabel('Endpoint 1', { exact: true })).toHaveValue('https://api.deepseek.com');
    await panel.getByRole('button', { name: 'Add model', exact: true }).click();
    await panel.getByLabel('Model 1.1', { exact: true }).fill('custom-model');
    await panel.getByRole('button', { name: 'Check models', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('1 configured model recognised');
    await panel.getByLabel('Model 1.1', { exact: true }).fill('renamed-model');
    await expect(panel.getByRole('radio', { name: 'Use by default', exact: true })).toBeChecked();
    await expect.poll(async () => (await api('/profiles')).profiles[0].defaultModel).toBe('deepseek/renamed-model');
});

test('distinguishes a Pi crash from a failed API request and redacts diagnostic details', async ({ page }) => {
    await seed();
    const doc = await api('/profiles');
    const broken = profile('pi-a', 'Diagnostic profile', 'openai');
    broken.connections[0].models[0].id = 'diagnostic-crash';
    broken.defaultModel = 'openai/diagnostic-crash';
    await api('/profiles', 'PUT', { version: 1, installations: doc.installations, profiles: [broken] });
    await page.goto('works');
    await page.getByRole('tab', { name: 'Pi profiles', exact: true }).click();
    const panel = page.getByTestId('agent-profiles-panel');
    await panel.getByRole('button', { name: 'Test API connection', exact: true }).click();
    const status = panel.getByRole('status');
    await expect(status).toContainText('Pi stopped unexpectedly');
    await expect(status).toContainText('API access could not be verified');
    await status.getByText('Technical details', { exact: true }).click();
    await expect(status.locator('pre')).toBeVisible();
    await expect(status.locator('pre')).toContainText('Pi exit status: 7');
    await expect(status.locator('pre')).toContainText('simulated Pi crash using <redacted>');
    await expect(panel).not.toContainText('fixture-key-A');
    await panel.getByLabel('Model 1.1', { exact: true }).fill('diagnostic-api-error');
    await panel.getByRole('button', { name: 'Test API connection', exact: true }).click();
    await expect(status).toContainText('The model API request failed');
    await expect(status.locator('pre')).toBeVisible();
    await expect(status.locator('pre')).toContainText('401 Invalid API key: <redacted>');
    await expect(panel).not.toContainText('fixture-key-A');
});

test('runs Pi chat, deferred messages, browser reconnect and stop', async ({ page }) => {
    const prompts: any[]=[];
    page.on('websocket',socket => socket.on('framesent',frame => { const message=JSON.parse(String(frame.payload));if(message.type==='prompt')prompts.push(message); }));
    await seed();
    await page.goto('works'); await tab(page, 'Conversations');
    await page.getByRole('button', { name: 'New Pi (Agent) conversation', exact: true }).click();
    await choose(page, 'Conversation profile', 'Pi account A · pi-a');
    await page.getByRole('button', { name: 'Create conversation', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const conversations = await api('/conversations');
    const conversation = conversations.find((one: any) => one.profileId === 'pi-a');
    expect(conversation).toBeTruthy();
    await flushViewState(page);
    await expect.poll(async () => {
        const response = await page.request.get(`${workerApi()}/config/dashboard-view-state.json`);
        return (await response.json()).global?.chat?.activeConversationId;
    }).toBe(conversation.id);
    const box = page.locator('.chat-textarea');
    await box.fill('slow'); await box.press('Control+Enter');
    await expect.poll(() => prompts[0]?.model).toBe('openai/shared-model');
    await expect(page.getByRole('combobox', { name: 'Message delivery', exact: true })).toBeVisible();
    await choose(page, 'Message delivery', 'After current work');
    await box.fill('after work'); await box.press('Control+Enter');
    await expect(page.getByTestId('chat-queue')).toContainText('pending');
    await flushViewState(page); await page.reload(); await tab(page, 'Conversations');
    await expect(page.getByTestId('chat-queue')).toContainText('delivered', { timeout: 15000 });
    await expect.poll(async () => (await api(`/conversations/${conversation.id}`)).running).toBe(false);
    await expect(page.getByRole('button', { name: /Stop$/ })).toBeHidden();
    await box.fill('slow');
    await page.getByRole('button', { name: /Send$/ }).click();
    await expect.poll(async () => (await api(`/conversations/${conversation.id}`)).running).toBe(true);
    await page.getByRole('button', { name: /Stop$/ }).click();
    await expect.poll(async () => (await api(`/conversations/${conversation.id}`)).running).toBe(false);
    const transcript = await api(`/conversations/${conversation.id}`);
    expect(transcript.messages.at(-1).interrupted).toBe(true);
    expect(JSON.stringify(transcript)).not.toContain('fixture-key-A');
    expect(transcript.messages.at(-1).execution).toMatchObject({ profileId: 'pi-a', version: '1.3.0', provider: 'openai' });
    await api(`/conversations/${conversation.id}`, 'DELETE');
});

test('plays a Pi chain with compaction and a profile change using separate conversations', async () => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'needs the explicitly configured throwaway boards backend');
    await seed();
    const a = await api('/agents', 'POST', { name: `Pi A ${Date.now()}`, platform: 'pi', profileId: 'pi-a', model: 'openai/shared-model', instructions: 'Task instructions A' });
    const b = await api('/agents', 'POST', { name: `Pi B ${Date.now()}`, platform: 'pi', profileId: 'pi-b', model: 'deepseek/shared-model', instructions: 'Task instructions B' });
    await api(`/agents/${a.id}/publish`, 'POST', {});
    await api(`/agents/${b.id}/publish`, 'POST', {});
    const board = await api('/boards', 'POST', { name: `Pi chain ${Date.now()}` });
    const handle = board.board?.slug || board.slug;
    try {
        const first = crypto.randomUUID(), next = crypto.randomUUID();
        await api(`/boards/${handle}/flow-nodes`, 'POST', { flowNodes: [
            { id: first, title: 'First Pi task', type: 'ai', body: 'First task', status: 'ready', settings: { agent: a.id, effort: 'off', permission: 'bypassPermissions', folder: '/' }, spot: { x: 100, y: 100 }, onSuccess: { flowNode: next, mode: 'continue', compact: true } },
            { id: next, title: 'Next profile task', type: 'ai', body: 'Next task', status: 'ready', settings: { agent: b.id, effort: 'off', permission: 'bypassPermissions', folder: '/' }, spot: { x: 500, y: 100 } },
        ] });
        const started = await api('/chain-runs/play', 'POST', { path: handle, flowNodeId: first, name: 'Pi qualification' });
        await expect.poll(async () => (await api('/chain-runs')).runs.find((one: any) => one.id === started.run.id)?.state, { timeout: 25000 }).toBe('ended');
        const detail = await api(`/boards/${handle}`);
        expect(detail.flowNodes.map((one: any) => one.status)).toEqual(['done', 'done']);
        const one = await api(`/conversations/${detail.flowNodes.find((node:any) => node.id === first).chat}`);
        const two = await api(`/conversations/${detail.flowNodes.find((node:any) => node.id === next).chat}`);
        expect(one.profileId).toBe('pi-a'); expect(two.profileId).toBe('pi-b');
        expect(one.sessionId).not.toBe(two.sessionId);
        expect(two.messages.filter((one: any) => one.role === 'user').at(-1).composedPrompt).toContain('Previous conversation transcript');
        await api(`/agents/${a.id}`, 'PATCH', {profileId:'pi-b',model:'deepseek/shared-model'});
        await api(`/agents/${a.id}/publish`, 'POST', {});
        await api(`/boards/${handle}/flow-nodes/${first}`, 'PATCH', {status:'ready',onSuccess:{flowNode:'',mode:'end'}});
        const replay = await api('/chain-runs/play','POST',{path:handle,flowNodeId:first,name:'Changed profile replay'});
        await expect.poll(async () => (await api('/chain-runs')).runs.find((one:any) => one.id === replay.run.id)?.state,{timeout:20000}).toBe('ended');
        const replayed = await api(`/boards/${handle}`);
        const newChat = await api(`/conversations/${replayed.flowNodes.find((one:any) => one.id === first).chat}`);
        expect(newChat.profileId).toBe('pi-a');
        expect(newChat.id).toBe(one.id);
        expect(newChat.agentVersion.version).toBe(1);
        await api(`/boards/${handle}/flow-nodes/${first}`, 'PATCH', { status: 'ready', chat: '' });
        const fresh = await api('/chain-runs/play', 'POST', { path: handle, flowNodeId: first, name: 'New published profile' });
        await expect.poll(async () => (await api('/chain-runs')).runs.find((one:any) => one.id === fresh.run.id)?.state, {timeout:20000}).toBe('ended');
        const after = await api(`/boards/${handle}`);
        const freshChat = await api(`/conversations/${after.flowNodes.find((node:any) => node.id === first).chat}`);
        expect(freshChat.profileId).toBe('pi-b');
        expect(freshChat.agentVersion.version).toBe(2);
        expect(freshChat.id).not.toBe(one.id);

    } finally {
        await api(`/boards/${handle}`, 'DELETE');
        await api(`/agents/${a.id}`, 'PATCH', { archived: true });
        await api(`/agents/${b.id}`, 'PATCH', { archived: true });
    }
});
