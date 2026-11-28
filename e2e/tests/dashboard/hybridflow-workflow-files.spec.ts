import { test, expect, fileUrl, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

test('configures workflow files in Dashboard and copies them before starting the next task', async ({ page, request }) => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');
    const suffix = crypto.randomUUID().slice(0, 8);
    const source = `workflow-input-${suffix}`;
    const output = `workflow-output-${suffix}`;
    const folder = `/${output}/run`;
    const hiddenFile = '.settings/.seed';
    const seeded = await request.put(`${workerApi()}/update?path=${encodeURIComponent(`${source}/${hiddenFile}`)}`, {
        multipart: { file: { name: '.seed', mimeType: 'text/plain', buffer: Buffer.from('Hidden input') } },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);

    const boards = `${workerApi()}/hybridflow-runner/boards`;
    const post = async (path: string, data: Record<string, unknown>) => {
        const response = await request.post(path, { data });
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
    };
    const { board } = await post(boards, { name: `Workflow files ${suffix}` });
    const path = `${boards}/${board.slug}`;
    try {
        const workflow = await post(`${path}/workflows`, { name: 'Review' });
        const startId = crypto.randomUUID();
        const reviewId = crypto.randomUUID();
        await post(`${path}/flow-nodes`, { flowNodes: [
            { id: startId, type: 'start', workflow: workflow.id, spot: { x: 80, y: 80 },
                onSuccess: { flowNode: reviewId } },
            { id: reviewId, type: 'human', title: 'Review inputs', status: 'ready', workflow: workflow.id,
                spot: { x: 240, y: 80 }, body: 'Open [the copy]({{workflowFolder}}/welcome.md).' },
        ] });

        await page.goto(`boards/${board.slug}`);
        const treeTab = page.getByTestId('tool-bar-left').getByRole('tab', { name: 'File tree', exact: true });
        if (!await treeTab.isVisible()) await page.getByTestId('bar-toggle-left').click();
        await treeTab.click();
        const treeRow = (path: string) => page.getByTestId('nav-tree').locator(`[data-row-path="${path}"]`);
        const openWorkflow = () => page.getByTestId('content-workflow').click({ position: { x: 20, y: 12 } });
        await openWorkflow();
        const panel = page.getByTestId('workflow-panel');
        const folderInput = panel.getByRole('textbox', { name: 'Folder' });
        const files = panel.getByRole('region', { name: 'Files', exact: true });
        const start = page.locator(`[data-flow-node-id="${startId}"]`);

        await treeRow('folder-a').dragTo(folderInput);
        await expect(folderInput).toHaveValue('/folder-a');
        await expect(panel.getByRole('alert')).toContainText('Invalid workflow');
        await expect(start.getByTestId('play-flow-node')).toHaveCount(0);
        await folderInput.fill(folder);
        await folderInput.press('Enter');
        await expect(folderInput).toHaveValue(folder);

        await treeRow(source).dragTo(files);
        await expect(files.getByRole('listitem')).toHaveText([`/${source}`]);
        await treeRow('welcome.md').dragTo(files);
        await expect(files.getByRole('listitem')).toHaveText([`/${source}`, '/welcome.md']);
        await files.getByRole('button', { name: 'Remove /welcome.md', exact: true }).click();
        await expect(files.getByRole('listitem')).toHaveText([`/${source}`]);
        await treeRow('welcome.md').dragTo(files);
        await expect(files.getByRole('listitem')).toHaveCount(2);

        await page.reload();
        await openWorkflow();
        await expect(folderInput).toHaveValue(folder);
        await expect(files.getByRole('listitem')).toHaveText([`/${source}`, '/welcome.md']);
        await expect(panel.getByRole('alert')).toHaveCount(0);
        const filesHeight = (await files.boundingBox())!.height;
        const valuesHeight = (await panel.getByRole('region', { name: 'Shared values' }).boundingBox())!.height;
        expect(filesHeight / (filesHeight + valuesHeight)).toBeCloseTo(0.3, 2);

        await start.getByTestId('play-flow-node').click();
        await page.getByRole('dialog', { name: 'Start a chain run' }).getByRole('button', { name: 'Start', exact: true }).click();
        const review = page.locator(`[data-flow-node-id="${reviewId}"]`);
        await expect(review).toHaveAttribute('data-status', 'todo');
        const hiddenCopy = await request.get(fileUrl(`${folder}/${source}/${hiddenFile}`));
        expect(hiddenCopy.ok()).toBe(true);
        expect(await hiddenCopy.text()).toBe('Hidden input');
        const copy = await request.get(fileUrl(`${folder}/welcome.md`));
        expect(copy.ok()).toBe(true);
        expect(await copy.text()).toBe(await (await request.get(fileUrl('welcome.md'))).text());

        await review.click();
        await page.getByRole('button', { name: 'Work on this task', exact: true }).click();
        const link = page.getByTestId('work-on-task').getByRole('link', { name: 'the copy' });
        await expect(link).toHaveAttribute('href', `/dashboard${folder}/welcome.md`);
    } finally {
        await request.delete(path);
        for (const path of [source, output]) {
            await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(path)}`);
        }
    }
});
