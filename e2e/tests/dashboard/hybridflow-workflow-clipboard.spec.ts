import { test, expect, workerApi } from '../harness';

test('copies a workflow as JSON and pastes an independent workflow on the same board', async ({ page, request }) => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const boards = `${workerApi()}/hybridflow-runner/boards`;
    const post = async (path: string, data: Record<string, unknown>) => {
        const response = await request.post(path, { data });
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
    };
    const { board } = await post(boards, { name: `Workflow clipboard ${crypto.randomUUID().slice(0, 8)}` });
    const path = `${boards}/${board.slug}`;
    try {
        const workflow = await post(`${path}/workflows`, { name: 'Release checks' });
        const values = { phase: { note: 'Approved', steps: [false, null] }, retries: 2 };
        const files = ['/welcome.md', '/folder-a'];
        const workflowFolder = '/release';
        const updated = await request.patch(`${path}/workflows/${workflow.id}`, {
            data: { setValues: values, workflowFolder, files },
        });
        expect(updated.ok(), await updated.text()).toBe(true);
        const planId = crypto.randomUUID(), reviewId = crypto.randomUUID(), archivedId = crypto.randomUUID();
        await post(`${path}/flow-nodes`, { flowNodes: [
            { id: planId, title: 'Plan', type: 'human', body: 'Plan the release.', chat: 'source-chat',
                workflow: workflow.id, spot: { x: 80, y: 80 }, onSuccess: { flowNode: reviewId } },
            { id: reviewId, title: 'Review', type: 'human', workflow: workflow.id, spot: { x: 410, y: 140 } },
            { id: archivedId, title: 'Example', type: 'value', value: null, archived: true,
                workflow: workflow.id, spot: { x: 410, y: 300 } },
        ] });

        await page.goto(`boards/${board.slug}`);
        const rectangle = page.getByTestId('content-workflow');
        const opening = { button: 'right' as const, position: { x: 20, y: 12 }, timeout: 10000 };
        await rectangle.click(opening);
        await page.getByRole('menuitem', { name: 'Copy workflow as JSON' }).click();
        await expect(page.getByText('“Release checks” copied as JSON.')).toBeVisible();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        const clipboard = JSON.parse(text);
        expect(clipboard).toMatchObject({
            kind: 'kiao-workflow', version: 1, workflow: { name: 'Release checks', values, workflowFolder, files },
            flowNodes: expect.arrayContaining([
                expect.objectContaining({ id: planId, title: 'Plan', type: 'human', body: 'Plan the release.',
                    spot: { x: 80, y: 80 }, onSuccess: { flowNode: reviewId, mode: 'end' } }),
                expect.objectContaining({ id: archivedId, value: null, archived: true }),
            ]),
        });
        expect(clipboard.flowNodes).toHaveLength(3);

        await rectangle.click(opening);
        const viaDashboard = page.waitForResponse(response =>
            response.request().method() === 'POST' && response.url().endsWith('/workflows/clipboard'));
        await page.getByRole('menuitem', { name: 'Paste here' }).click();
        const response = await viaDashboard;
        expect(response.ok(), await response.text()).toBe(true);
        const pasted = await response.json();
        const plan = pasted.flowNodes.find((node: { title: string }) => node.title === 'Plan');
        const review = pasted.flowNodes.find((node: { title: string }) => node.title === 'Review');
        expect(pasted.workflow.id).not.toBe(workflow.id);
        expect(pasted.workflow).toMatchObject({ values, workflowFolder, files });
        expect(plan.id).not.toBe(planId);
        expect(review.id).not.toBe(reviewId);
        expect(plan).toMatchObject({ workflow: pasted.workflow.id, onSuccess: { flowNode: review.id } });
        expect(plan.chat).toBeUndefined();
        expect(plan.spot.y).toBeGreaterThan(300);
        expect(review.spot.y - plan.spot.y).toBe(60);
        expect(review.spot.x - plan.spot.x).toBe(330);
        await expect(page.getByTestId('content-workflow')).toHaveCount(2);
        const stored = await (await request.get(path)).json();
        expect(stored.workflows).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: pasted.workflow.id, values, workflowFolder, files }),
            expect.objectContaining({ id: workflow.id, values, workflowFolder, files }),
        ]));
        expect(stored.flowNodes.find((node: { id: string }) => node.id === planId)).toMatchObject({
            workflow: workflow.id, chat: 'source-chat', onSuccess: { flowNode: reviewId },
        });
    } finally {
        await request.delete(path);
    }
});
