import { test, expect, APIRequestContext, Page, resetViewState, workerApi } from '../harness';

const SOURCES = 'kiao-user-config/decisions.json';
const FOLDER = 'smoke/decisions-panel';
const FILE = `${FOLDER}/10-design (review).md`;

const write = async (request: APIRequestContext, path: string, content: string) => {
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: {
            file: { name: path.split('/').pop()!, mimeType: 'text/plain', buffer: Buffer.from(content) },
        },
    });
    expect(response.ok(), `writing ${path}`).toBeTruthy();
};

const decisionText = (id: string, date: string) => `---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
${date ? `date: "${date}"\n` : ''}tags: [design]
---

# Decision ${id}

## Context and Problem Statement

The decision needs a readable record.

## Considered Options

* Keep a Markdown record.

## Decision Outcome

Chosen option: "Keep a Markdown record", because the record can be opened from the panel.
`;

const open = async (page: Page, column: 'left' | 'center' = 'center') => {
    const response = await fetch(`${workerApi()}/config/dashboard-view-state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            global: {
                toolBars: {
                    placement: { decisions: column, conversations: 'right' },
                    selected: { [column]: 'decisions', right: 'conversations' },
                    off: column === 'left' ? [] : ['left', 'right'],
                    width: { left: 400, right: 350 },
                },
            },
            folders: {},
            files: {},
        }),
    });
    expect(response.ok, 'seeding the layout').toBeTruthy();
    await page.goto(column === 'left' ? 'templates/Document.temp.md' : 'welcome.md');
    await page.getByTestId(`tool-bar-${column}`).getByRole('tab', { name: 'Decisions', exact: true }).click();
    await expect(page.getByTestId('decisions-panel')).toBeVisible();
    await expect(page.getByTestId('decision-row')).toHaveCount(3);
};

test.beforeEach(async ({ request }) => {
    await write(request, SOURCES, JSON.stringify([{ path: FOLDER, name: 'Design' }]));
    await write(request, `${FOLDER}/1.md`, decisionText('1', '2026-01-01'));
    await write(request, FILE, decisionText('10', '2026-02-01'));
    await write(request, `${FOLDER}/2.md`, decisionText('2', ''));
});

test.afterEach(async ({ request }) => {
    await resetViewState();
    for (const path of [SOURCES, FOLDER]) {
        const response = await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(path)}`);
        expect(response.ok(), `removing ${path}`).toBeTruthy();
    }
});

test('sorts by date and numeric ID in both directions', async ({ page }) => {
    await open(page);
    const panel = page.getByTestId('decisions-panel');
    const ids = panel.getByTestId('decision-row').locator('td:nth-child(2)');
    const date = panel.getByRole('columnheader').filter({ has: page.getByTestId('decisions-sort-date') });
    const id = panel.getByRole('columnheader').filter({ has: page.getByTestId('decisions-sort-id') });

    await expect(ids).toHaveText(['10', '1', '2']);
    await expect(date).toHaveAttribute('aria-sort', 'descending');
    await panel.getByRole('button', { name: 'Date' }).click();
    await expect(ids).toHaveText(['1', '10', '2']);
    await expect(date).toHaveAttribute('aria-sort', 'ascending');
    await panel.getByRole('button', { name: 'Date' }).click();
    await expect(ids).toHaveText(['10', '1', '2']);

    const byId = panel.getByTestId('decisions-sort-id');
    await byId.focus();
    await page.keyboard.press('Enter');
    await expect(ids).toHaveText(['1', '2', '10']);
    await expect(id).toHaveAttribute('aria-sort', 'ascending');
    await expect(date).not.toHaveAttribute('aria-sort');
    await byId.press('Space');
    await expect(ids).toHaveText(['10', '2', '1']);
    await expect(id).toHaveAttribute('aria-sort', 'descending');

    await panel.getByTestId('decisions-filter').fill('design');
    await expect(ids).toHaveText(['10', '2', '1']);
    await panel.getByRole('button', { name: 'Date' }).click();
    await expect(ids).toHaveText(['1', '10', '2']);
});

test('filters MADR status independently from document status and opens the record', async ({ page }) => {
    await open(page);
    const panel = page.getByTestId('decisions-panel');
    const filter = panel.getByTestId('decisions-filter');
    await filter.fill('draft');
    await expect(panel.getByTestId('decision-row')).toHaveCount(0);
    await filter.fill('accepted design');
    await expect(panel.getByTestId('decision-row')).toHaveCount(3);
    await panel.getByRole('link', { name: 'Decision 10', exact: true }).click();
    await expect(page.locator('.configured-markdown-container').getByRole('heading', { name: 'Decision 10', exact: true }))
        .toBeVisible();
});

test('drags a decision file into a file field and a conversation', async ({ page }) => {
    await open(page, 'left');
    const row = page.getByTestId('decision-row').filter({ has: page.getByRole('link', { name: 'Decision 10', exact: true }) });
    await expect(row).toHaveAttribute('draggable', 'true');

    const field = page.getByTestId('template-file-doc');
    await expect(field).toBeVisible();
    await row.dragTo(field, { sourcePosition: { x: 10, y: 10 } });
    await expect(field).toHaveValue(`/${FILE}`);

    const composer = page.locator('.chat-textarea');
    await expect(composer).toBeVisible();
    await row.getByRole('link').dragTo(composer);
    await expect(composer).toHaveValue('[10-design (review).md](/smoke/decisions-panel/10-design%20%28review%29.md)');
});

test('keeps the header fixed and opaque in every theme while scrolling', async ({ page, request }) => {
    await open(page);
    for (let id = 11; id <= 50; id++) {
        await write(request, `${FOLDER}/${id}.md`, decisionText(String(id), '2026-03-01'));
    }
    const panel = page.getByTestId('decisions-panel');
    await panel.getByRole('button', { name: 'Read the sources again' }).click();
    await expect(panel.getByTestId('decision-row')).toHaveCount(43);

    const headers = panel.getByRole('columnheader');
    const initialTop = (await headers.first().boundingBox())!.y;
    const scroller = panel.locator('table').locator('..');
    await scroller.evaluate(element => { element.scrollTop = 250; });
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(250);
    expect(Math.abs((await headers.first().boundingBox())!.y - initialTop)).toBeLessThan(1);
    expect((await panel.getByTestId('decision-row').first().boundingBox())!.y).toBeLessThan(initialTop);

    for (const theme of ['dark', 'light', 'sober-dark', 'sober-light']) {
        await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
        const background = await panel.locator('thead').evaluate(element => getComputedStyle(element).backgroundColor);
        expect(background).not.toBe('rgba(0, 0, 0, 0)');
        for (const header of await headers.all()) {
            await expect(header).toHaveCSS('background-color', background);
            await expect(header).toHaveCSS('position', 'sticky');
        }
    }
});
