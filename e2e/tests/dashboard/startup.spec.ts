import { test, expect } from '../harness';

test.use({ serviceWorkers: 'block' });

const MAP = 'folder-a/Mindmap.mmap.json';

const viewState = {
    version: 1,
    global: { toolBars: {
        off: [], width: {}, placement: { git: 'left', conversations: 'right' },
        selected: { left: 'git', right: 'conversations' },
    } },
    folders: {}, files: {},
};

test('a document renders while the Git and Conversations interfaces are still loading', async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const held = new Set<string>();

    await page.route(/\/(GitPanel|ChatPrompt)(?:\.tsx|-[^/]+\.js)(?:\?.*)?$/, async route => {
        held.add(route.request().url().includes('GitPanel') ? 'git' : 'chat');
        await pending;
        await route.continue();
    });
    await page.route('**/api/files/config/dashboard-view-state.json', route => route.fulfill({
        json: viewState,
    }));

    try {
        await page.goto(MAP, { waitUntil: 'commit' });
        await expect.poll(() => held.size).toBeGreaterThan(0);
        await expect(page.locator('.mindmap-zoom-container')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Note A', { exact: true })).toBeVisible();
        expect([...held].sort()).toEqual(['chat', 'git']);
    } finally {
        release();
    }

    await expect(page.locator('.chat-prompt')).toBeVisible();
});

test('configuration and view state start loading independently', async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let viewStateRequested = false;

    await page.route('**/api/files/config/dashboard.json', async route => {
        await pending;
        await route.continue();
    });
    await page.route('**/api/files/config/dashboard-view-state.json', async route => {
        viewStateRequested = true;
        await route.fulfill({ json: viewState });
    });

    try {
        await page.goto(MAP, { waitUntil: 'commit' });
        await expect.poll(() => viewStateRequested).toBe(true);
    } finally {
        release();
    }
    await expect(page.locator('.mindmap-zoom-container')).toBeVisible();
});

test('slow panel services do not delay the open document', async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const held = new Set<string>();
    await page.route(/\/api\/files\/(git\/(status|fetch)|hybridflow-runner\/(conversations|options))(?:\?.*)?$/, async route => {
        held.add(route.request().url().includes('/git/') ? 'git' : 'chat');
        await pending;
        await route.continue();
    });
    await page.route('**/api/files/config/dashboard-view-state.json', route => route.fulfill({ json: viewState }));

    try {
        await page.goto(MAP, { waitUntil: 'commit' });
        await expect.poll(() => [...held].sort()).toEqual(['chat', 'git']);
        await expect(page.getByText('Note A', { exact: true })).toBeVisible();
        await expect(page.locator('.chat-prompt')).toBeVisible();
    } finally {
        release();
    }
});

test('a built mindmap does not load unrelated shared editors or diagram engines', async ({ page }) => {
    test.skip(process.env.E2E_BUILT !== '1', 'Exercises the production import map');
    const requested: string[] = [];
    await page.route(/\/runtime\/(mermaid|kit-code-editor|kit-markdown-editor)\.js$/, async route => {
        requested.push(route.request().url());
        await route.abort();
    });

    await page.goto(MAP);
    await expect(page.getByText('Note A', { exact: true })).toBeVisible();
    expect(requested).toEqual([]);
});

test('changing document type keeps the app services initialized', async ({ page }) => {
    let fetches = 0;
    let sockets = 0;
    page.on('websocket', socket => {
        if (socket.url().includes('hybridflow-runner')) sockets++;
    });
    await page.route('**/api/files/git/fetch', async route => {
        fetches++;
        await route.continue();
    });
    await page.route('**/api/files/config/dashboard-view-state.json', route => route.fulfill({ json: viewState }));

    await page.goto(MAP);
    await expect(page.getByText('Note A', { exact: true })).toBeVisible();
    await expect(page.locator('.chat-prompt')).toBeVisible();
    await expect.poll(() => sockets).toBeGreaterThan(0);
    const initial = { fetches, sockets };
    expect(initial).toEqual({ fetches: 1, sockets: 1 });

    await page.locator('[data-testid="tool-bar-side-left"] .ant-tabs-tab [aria-label="File tree"]').click();
    await expect(page.getByTestId('nav-tree')).toBeVisible();
    await page.getByTestId('nav-item-folder-a/note.md').click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('.chat-prompt')).toBeVisible();
    expect({ fetches, sockets }).toEqual(initial);

    await page.getByTestId('nav-item-folder-a/Mindmap.mmap.json').click();
    await expect(page.getByText('Note A', { exact: true })).toBeVisible();
    await expect(page.locator('.chat-prompt')).toBeVisible();
    expect({ fetches, sockets }).toEqual(initial);
});
