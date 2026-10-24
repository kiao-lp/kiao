import { test, expect, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

test('publishes agent drafts, reads immutable versions and restores archived agents', async ({ page, request }) => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires a throwaway hybridflow-store');
    const api = async (path: string, method = 'GET', data?: unknown) => {
        const response = await request.fetch(`${workerApi()}/hybridflow-runner${path}`, { method, data });
        expect(response.ok(), await response.text()).toBeTruthy();
        return response.status() === 204 ? undefined : response.json();
    };
    const name = `Publication ${crypto.randomUUID()}`;
    const agent = await api('/agents', 'POST', { name, platform: 'claude', model: 'retired-model', instructions: 'First published orders.' });
    try {
        await page.goto('works');
        if (await page.getByTestId('tool-bar-side-right').count() === 0) await page.getByTestId('bar-toggle-right').click();
        await page.getByRole('tab', { name: 'Node agents', exact: true }).click();
        const row = page.getByTestId('agent-card').filter({ hasText: name });
        await expect(row).toContainText('Unpublished');
        await row.getByTestId('edit-agent').click();
        const editor = page.getByTestId('agent-editor');
        await editor.getByTestId('publish-agent').click();
        await expect(row).toContainText('Published v1');
        await editor.getByTestId('agent-instructions').fill('Second published orders.');
        await editor.getByTestId('agent-instructions').press('Tab');
        await expect.poll(async () => (await api(`/agents/${agent.id}`)).instructions).toBe('Second published orders.');
        expect((await api(`/agents/${agent.id}`)).published.instructions).toBe('First published orders.');
        await editor.getByTestId('publish-agent').click();
        await expect(row).toContainText('Published v2');
        await editor.getByRole('combobox', { name: 'Agent version', exact: true }).press('ArrowDown');
        await page.locator('.ant-select-dropdown:visible').getByText('Published v1', { exact: true }).click({ timeout: 10000 });
        await expect(editor.getByTestId('agent-publication')).toContainText('First published orders.');
        await expect(editor.getByTestId('agent-publication')).toContainText('retired-model');
        await page.getByTestId('central-panel-agent-editor-close').click();
        await row.getByRole('button', { name: `Archive ${name}`, exact: true }).click();
        await expect(row).toHaveCount(0);
        await page.getByRole('checkbox', { name: 'Show archived' }).check();
        await expect(row).toContainText('Claude · retired-model');
        await row.getByRole('button', { name: `Restore ${name}`, exact: true }).click();
        await page.getByRole('checkbox', { name: 'Show archived' }).uncheck();
        await expect(row).toBeVisible();
        const versions = (await api(`/agents/${agent.id}/versions`)).versions;
        expect(versions.map((one: any) => one.instructions)).toEqual(['First published orders.', 'Second published orders.']);
    } finally {
        await api(`/agents/${agent.id}`, 'PATCH', { archived: true }).catch(() => {});
    }
});
