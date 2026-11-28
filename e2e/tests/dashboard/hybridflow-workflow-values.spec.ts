import { test, expect, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

test('edits shared workflow values as JSON and uses them in a Human task', async ({ page, request }) => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');

    const boards = `${workerApi()}/hybridflow-runner/boards`;
    const send = async (method: 'POST' | 'PATCH', path: string, data: Record<string, unknown>) => {
        const response = await request.fetch(path, { method, data });
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
    };
    const { board } = await send('POST', boards, { name: `Workflow values ${crypto.randomUUID().slice(0, 8)}` });
    const path = `${boards}/${board.slug}`;
    try {
        const workflow = await send('POST', `${path}/workflows`, { name: 'Release' });
        const workflowPath = `${path}/workflows/${workflow.id}`;
        const title = 'Review {{currentWorkflow.phase.note}}';
        await send('POST', `${path}/flow-nodes`, { flowNodes: [{
            title, type: 'human', status: 'todo', workflow: workflow.id, spot: { x: 80, y: 80 },
            body: '{{currentWorkflow.name}}: {{currentWokflow.phase.note}} / {{currentWorkflow.external}}.',
        }] });

        await page.goto(`boards/${board.slug}`);
        const card = page.getByTestId('flow-node-card');
        await expect(card.getByText(title, { exact: true })).toBeVisible();
        const openWorkflow = () => page.getByTestId('content-workflow').click({ position: { x: 20, y: 12 } });
        await openWorkflow();
        const panel = page.getByTestId('workflow-panel');
        const editor = panel.getByRole('textbox', { name: 'Workflow values (JSON)' });
        await expect(editor).toHaveText('{}');

        await send('PATCH', workflowPath, { setValues: { phase: { note: 'Draft' }, retired: true } });
        await expect(editor).toContainText('"Draft"');
        await expect(card.getByText('Review Draft', { exact: true })).toBeVisible();

        await editor.fill('{"phase":');
        await expect(panel.getByRole('alert')).toHaveText('Invalid JSON');
        await send('PATCH', workflowPath, { setValues: { external: 'Retained' } });
        await expect(editor).toHaveText('{"phase":');
        await editor.fill('[]');
        await expect(panel.getByRole('alert')).toHaveText('Workflow values must be a JSON object.');
        await editor.fill('{"name":"Other"}');
        await expect(panel.getByRole('alert')).toHaveText('Workflow ID and name are read-only in JSON.');

        const phase = { note: 'Approved', steps: [false, null] };
        await editor.fill(JSON.stringify({ phase, decision: null }));
        await expect.poll(async () => (await (await request.get(workflowPath)).json()).values)
            .toEqual({ phase, decision: null, external: 'Retained' });
        await expect(editor).toContainText('"Retained"');

        await page.reload();
        await openWorkflow();
        await expect(editor).toContainText('"Approved"');
        await expect(card.getByText('Review Approved', { exact: true })).toBeVisible();
        await card.click();
        await expect(page.getByTestId('flow-node-title')).toHaveValue(title);
        await page.getByRole('button', { name: 'Work on this task', exact: true }).click();
        await expect(page.getByTestId('work-on-task')).toContainText('Release: Approved / Retained.');
    } finally {
        await request.delete(path);
    }
});
