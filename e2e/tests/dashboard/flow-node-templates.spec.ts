import type { APIRequestContext, Page } from '@playwright/test';
import { expect, resetViewState, test, workerApi } from '../harness';

test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');
test.afterEach(resetViewState);

type FlowNode = { id: string; title: string; body: string; multiPartTemplate?: boolean };

async function createBoard(request: APIRequestContext, body: string) {
    const boards = `${workerApi()}/hybridflow-runner/boards`;
    const made = await request.post(boards, { data: { name: `Description templates ${crypto.randomUUID().slice(0, 8)}` } });
    expect(made.ok(), await made.text()).toBe(true);
    const { board } = await made.json();
    const path = `${boards}/${board.slug}`;
    const created = await request.post(`${path}/flow-nodes`, { data: { flowNodes: [
        { title: 'Review', type: 'human', body, spot: { x: 100, y: 100 }, status: 'draft' },
    ] } });
    expect(created.ok(), await created.text()).toBe(true);
    const { flowNodes: [source] } = await created.json() as { flowNodes: FlowNode[] };
    const nodes = async () => (await (await request.get(path)).json()).flowNodes as FlowNode[];
    return { slug: board.slug, path, source, nodes };
}

async function copyReview(page: Page) {
    await page.getByTestId('flow-node-card').filter({ hasText: 'Review' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Copy node$/ }).click();
    await expect(page.getByText('“Review” copied as JSON.')).toBeVisible();
}

async function pasteOnCanvas(page: Page, action: 'Paste here' | 'Instantiate here', position = { x: 30, y: 30 }) {
    await page.getByTestId('content-canvas').click({ button: 'right', position });
    await page.getByRole('menuitem', { name: new RegExp(`${action}$`) }).click();
    return page.getByTestId('central-panel-clipboard-template-instantiation');
}

test('edits a multi-part description in the node panel and instantiates its clipboard copy', async ({ page, request }) => {
    const body = '# Checklist\n\n## Scope\n\nCheck the change.\n\n```sh\n# Review the diff\ngit diff --check\n```';
    const { slug, path, source, nodes } = await createBoard(request, body);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const panel = page.getByTestId('flow-node-panel');
    const toggle = panel.getByRole('switch', { name: 'Multi-part template' });
    const root = panel.getByPlaceholder('Template Body').first();
    const addTemplate = panel.getByRole('button', { name: 'Add template', exact: true });
    const syntaxHelp = panel.getByRole('button', { name: 'Syntax Help' });
    try {
        await page.goto(`boards/${slug}`);
        await page.getByTestId('flow-node-card').click();
        await expect(toggle).not.toBeChecked();
        await toggle.click();
        await expect(panel.getByRole('heading', { name: /Edit the template of/ })).toHaveCount(0);
        await expect(panel.getByLabel('Name', { exact: true })).toHaveCount(0);
        await expect(panel.getByTestId('panel-source')).toHaveCount(0);
        await expect(root).toHaveValue(body);
        await expect.poll(async () => (await nodes())[0]).toMatchObject({
            id: source.id, multiPartTemplate: true,
            body: ['## Root', '', '### textTemplate', '', '````text', body, '````', ''].join('\n'),
        });
        await root.fill(body + '\n\n${detail}');
        await addTemplate.click();
        await panel.getByPlaceholder('Template ID').last().fill('detail');
        await panel.getByRole('checkbox', { name: 'Default Text' }).last().check();
        await panel.getByPlaceholder('Template Body').last().fill('Double-check ${reason:text}.');
        await expect(syntaxHelp).toBeVisible();
        const [addBounds, helpBounds] = await Promise.all([addTemplate.boundingBox(), syntaxHelp.boundingBox()]);
        expect(helpBounds!.x).toBeGreaterThan(addBounds!.x);
        expect(helpBounds!.y).toBeCloseTo(addBounds!.y);
        await expect(root).toHaveCSS('font-size', await addTemplate.evaluate(button => getComputedStyle(button).fontSize));
        await syntaxHelp.hover();
        await expect(page.getByRole('tooltip')).toContainText('${templateId}');
        await expect.poll(async () => (await nodes())[0]).toMatchObject({
            id: source.id, multiPartTemplate: true,
            body: expect.stringMatching(/^## Root\n[\s\S]*Double-check \$\{reason:text\}\./),
        });

        await page.reload();
        await page.getByTestId('flow-node-card').click();
        await expect(toggle).toBeChecked();
        await expect(root).toHaveValue(body + '\n\n${detail}');
        await copyReview(page);
        const clipboard = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
        expect(clipboard.flowNode).toMatchObject({ id: source.id, multiPartTemplate: true });

        let form = await pasteOnCanvas(page, 'Instantiate here');
        await expect(form.getByRole('checkbox', { name: 'detail' })).toBeVisible();
        await form.getByRole('button', { name: 'Cancel' }).click();
        await expect(form).toBeHidden();
        expect(await nodes()).toHaveLength(1);

        form = await pasteOnCanvas(page, 'Instantiate here');
        await form.getByRole('checkbox', { name: 'detail' }).check();
        await form.getByPlaceholder('Type something...').fill('the tests');
        await form.getByRole('button', { name: 'Instantiate', exact: true }).click();
        await expect(form).toBeHidden();
        const copies = async () => (await nodes()).filter(node => node.id !== source.id);
        await expect.poll(copies).toEqual([expect.objectContaining({
            title: 'Review', body: body + '\n\nDouble-check the tests.',
        })]);
        expect((await copies())[0].multiPartTemplate).toBeUndefined();

        await pasteOnCanvas(page, 'Paste here', { x: 30, y: 250 });
        await expect.poll(copies).toEqual(expect.arrayContaining([expect.objectContaining({
            body: clipboard.flowNode.body, multiPartTemplate: true,
        })]));
        const plainCopy = (await copies()).find(node => node.multiPartTemplate)!;
        await expect(toggle).toBeChecked();
        await toggle.click();
        await expect(panel.getByLabel('Task description')).toHaveValue(clipboard.flowNode.body);
        await expect.poll(async () => (await nodes()).find(node => node.id === plainCopy.id)?.multiPartTemplate).toBeUndefined();
    } finally {
        await request.delete(path);
    }
});

test('asks how to use a description that looks like a multi-part template', async ({ page, request }) => {
    const body = [
        '# Review template', '', '## Root', '', '### textTemplate', '',
        '```text', 'Review the change.${detail}', '```', '',
        '## Detail', '', '### textTemplate', '', '```text', ' Check the tests.', '```', '',
    ].join('\n');
    const { slug, path, nodes } = await createBoard(request, body);
    const panel = page.getByTestId('flow-node-panel');
    const toggle = panel.getByRole('switch', { name: 'Multi-part template' });
    const dialog = page.getByRole('dialog', { name: 'Is the description already a multi-part template?' });
    const templateBodies = panel.getByPlaceholder('Template Body');
    const node = async () => (await nodes())[0];

    try {
        await page.goto(`boards/${slug}`);
        await page.getByTestId('flow-node-card').click();
        await toggle.click();
        await expect(dialog).toBeVisible();
        await expect(toggle).not.toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
        await expect(toggle).not.toBeChecked();
        await expect(panel.getByLabel('Task description')).toHaveValue(body);
        const unchanged = await node();
        expect(unchanged.body).toBe(body);
        expect(unchanged.multiPartTemplate).toBeUndefined();

        await toggle.click();
        await dialog.getByRole('button', { name: 'Use existing template' }).click();
        await expect(dialog).toBeHidden();
        await expect(toggle).toBeChecked();
        await expect(templateBodies).toHaveCount(2);
        await expect(templateBodies.first()).toHaveValue('Review the change.${detail}');
        await expect(templateBodies.last()).toHaveValue(' Check the tests.');
        await expect.poll(node).toMatchObject({ multiPartTemplate: true, body });

        await toggle.click();
        await expect(toggle).not.toBeChecked();
        await toggle.click();
        await dialog.getByRole('button', { name: 'Put text in Root' }).click();
        await expect(dialog).toBeHidden();
        await expect(toggle).toBeChecked();
        await expect(templateBodies).toHaveCount(1);
        await expect(templateBodies.first()).toHaveValue(body);
        await expect.poll(node).toMatchObject({
            multiPartTemplate: true, body: ['## Root', '', '### textTemplate', '', '````text', body, '````', ''].join('\n'),
        });
    } finally {
        await request.delete(path);
    }
});

test('instantiates variables in an unmarked Markdown description and preserves its headings', async ({ page, request }) => {
    const body = '# Checklist\n\n## Root\n\n### textTemplate\n\nReview ${artifact:text}.\n\n## Notes\n\nKeep this heading.';
    const { slug, path, source, nodes } = await createBoard(request, body);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    try {
        await page.goto(`boards/${slug}`);
        await copyReview(page);
        const form = await pasteOnCanvas(page, 'Instantiate here');
        await expect(form.getByPlaceholder('Type something...')).toBeVisible();
        expect(await nodes()).toHaveLength(1);
        await form.getByPlaceholder('Type something...').fill('the release');
        await form.getByRole('button', { name: 'Instantiate', exact: true }).click();
        await expect.poll(async () => (await nodes()).find(node => node.id !== source.id)).toMatchObject({
            body: body.replace('${artifact:text}', 'the release'),
        });
    } finally {
        await request.delete(path);
    }
});
