import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, resetViewState, flushViewState, workerApi } from '../harness';
import type { Page } from '../harness';

test.skip(process.env.E2E_CLAUDE_PERMISSIONS !== '1', 'requires the controlled Claude protocol fixture');

const openChat = async (page: Page, folder: string) => {
    await page.route(/\/hybridflow-runner\/auth\/status(?:\?.*)?$/, route => route.fulfill({ json: { loggedIn: true } }));
    const optionsReady = page.waitForResponse(response => response.url().endsWith('/hybridflow-runner/options') && response.ok());
    await page.goto(folder);
    await optionsReady;
    await expect(page.locator('.cms-top-banner')).toBeVisible();
    if (await page.getByTestId('tool-bar-side-right').count() === 0) await page.getByTestId('bar-toggle-right').click();
    await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
};

for (const failure of [false, true]) {
    test(failure ? 'reports a closed Claude approval stream after reopening the tab' : 'writes with Manual Live after the Dashboard tab closes', async ({ page, context, request }, testInfo) => {
        const folder = `permission-disconnect-${failure ? 'failure' : 'countdown'}`;
        const logPath = resolve(__dirname, `../../../log/worker-shard-${testInfo.parallelIndex}.log`);
        const readLog = () => readFileSync(logPath, 'utf8');
        const readConversation = async (id: string) => {
            const response = await request.get(`${workerApi()}/hybridflow-runner/conversations/${id}`);
            expect(response.ok()).toBeTruthy();
            return response.json();
        };
        await resetViewState();
        await request.post(`${workerApi()}/createFolder?path=${folder}`);
        let conversationId: string | undefined;
        let socketId: string | undefined;
        page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
            try {
                const frame = JSON.parse(String(payload));
                if (frame.type === 'hello' && frame.socketId) socketId = frame.socketId;
            } catch {}
        }));
        try {
            await openChat(page, folder);
            const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/hybridflow-runner/conversations'), { timeout: 10000 });
            await page.getByRole('button', { name: 'New Claude conversation', exact: true }).click();
            conversationId = (await (await created).json()).id;
            const mode = page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: 'Permission mode', exact: true }) });
            await mode.click();
            await page.locator('.ant-select-dropdown:visible').getByText('Live', { exact: true }).click();
            await page.locator('.chat-textarea').fill(failure ? 'fixture:approval-stream-closed' : 'fixture:tools');
            await page.getByRole('button', { name: /Send$/ }).click();
            await expect(page.getByText('Waiting for the next tool.', { exact: true })).toBeVisible({ timeout: 15000 });
            expect((await readConversation(conversationId!)).running).toBe(true);
            expect(socketId).toBeTruthy();
            await flushViewState(page);
            await page.close();
            await expect.poll(() => readLog().split('\n').some(line => line.includes('msg=disconnected') && line.includes(`socket=${socketId}`))).toBe(true);
            const gate = await request.put(`${workerApi()}/update?path=${folder}/permission-fixture-continue`, {
                multipart: { file: { name: 'permission-fixture-continue', mimeType: 'text/plain', buffer: Buffer.from('continue') } },
            });
            expect(gate.ok()).toBeTruthy();
            await expect.poll(async () => (await readConversation(conversationId!)).running, { timeout: 15000 }).toBe(false);
            const transcript = await readConversation(conversationId!);
            const last = transcript.messages.at(-1);
            if (failure) {
                expect(last.exitCode).not.toBe(0);
                expect(last.terminal).toBe('permission_channel_closed');
                expect(last.endReason).toContain("Claude's tool approval channel closed");
                expect(JSON.stringify(last)).not.toContain('Incorrectly continuing');
                const reopened = await context.newPage();
                await openChat(reopened, folder);
                await expect(reopened.getByRole('status').filter({ hasText: "Claude's tool approval channel closed" })).toBeVisible();
            } else {
                expect(last.exitCode).toBe(0);
                expect(last.asks).toHaveLength(2);
                expect(last.asks[1]).toMatchObject({ id: 'second', outcome: 'allow', decidedBy: 'countdown' });
                const written = await request.get(`${workerApi()}/getFile?path=${folder}/permission-fixture-second.txt`);
                expect(await written.text()).toContain('Written after approval');
                expect(readLog().split('\n').some(line => line.includes(`conversation=${conversationId}`)
                    && line.includes('request=second') && line.includes('subscribers=0'))).toBe(true);
            }
            const evidence = readLog().split('\n').filter(line => line.includes(`conversation=${conversationId}`) || line.includes(`socket=${socketId}`)).join('\n');
            await testInfo.attach('permissions-worker.log', { body: evidence, contentType: 'text/plain' });
        } finally {
            if (conversationId) await request.delete(`${workerApi()}/hybridflow-runner/conversations/${conversationId}`);
            await request.delete(`${workerApi()}/delete?path=${folder}`);
            await resetViewState();
        }
    });
}
