import { test, expect, Page, workerApi, flushViewState } from '../harness';

/**
 * E2E: the server-side conversation registry.
 *
 * A conversation is a record in the service's own state directory — its folder, its settings and
 * its transcript — and not a buffer belonging to the tab that made it. That is the whole point of
 * moving it off the client: the switcher survives a reload, a second tab sees the same list, and a
 * conversation created anywhere appears everywhere. So every step here is asserted against
 * `GET /hybridflow-runner/conversations` rather than against the list the click just rendered — a switcher
 * that kept its own private state would look identical from the browser and lose everything on the
 * next load.
 *
 * No prompt is sent. Creating, renaming, switching and deleting never reach a model, so a model
 * call would spend Anthropic quota only to make the spec wait on an answer it does not assert.
 *
 */

const TIMEOUT = 15000;
const VIEW_STATE_DOC = 'dashboard-view-state.json';

/** Both conversations are created here, so both are told apart by title rather than by folder. */
const FOLDER = 'works';

/**
 * Two conversations created empty are both named "New conversation" — the placeholder that a title
 * derived from the first prompt replaces. Since no prompt is sent, the spec names them itself,
 * which is also what makes the two rows tellable apart in the switcher.
 */
const TITLE_A = 'E2E conversation alpha';
const TITLE_B = 'E2E conversation beta';

/** The pinning test's own pair. The registry outlives a test, so two titles are never shared. */
const TITLE_PINNED = 'E2E conversation pinned';
const TITLE_LISTED = 'E2E conversation listed';

/**
 * The tool bar tab the panel hangs in, spelled as `plugins/chat` titles it. It read "Agents"
 * until the tab was renamed for what it holds rather than for what runs it, so it is named once
 * here — the strip and the undo below both go through this.
 */
const TAB_TITLE = 'Conversations';

const SELECTORS = {
    STATUS_BAR: '.cms-top-banner',
    RIGHT_TOGGLE: '[data-testid="bar-toggle-right"]',
    RIGHT_COLUMN: '[data-testid="tool-bar-side-right"]',
    ACTIVE_TAB_LABEL: '[data-testid="tool-bar-right"] .ant-tabs-tab-active [aria-label]',
};

/**
 * What the chat panel has to offer for this spec to drive it, in one place because it is a
 * contract with `plugins/chat` rather than a handful of incidental queries: the plus button
 * creates a conversation in the current folder, and the switcher is a select — one option per
 * conversation — with the actions of the selected one beside it, on `.chat-conversation-list`.
 *
 * A **pinned** conversation leaves that select for a column of its own, headed by a row carrying
 * the same actions: so `.chat-column` counts the chats the panel is showing at once, and
 * `--header` counts the pinned ones. Both are what the layout *is*, which is why they are asserted
 * through the DOM here while the pin itself is asserted through the registry.
 */
const PANEL = {
    ROOT: '.chat-prompt',
    /**
     * The title bar carries one starter per agent the deployment offers — the agent is fixed for a
     * conversation's life, so it is chosen before there is one. The first is the default agent's and
     * is the bare plus the bar has always had; the others are drawn with a plus of their own
     * (`anticon-plus-square`, `anticon-plus-circle`), which is what keeps this selector to one
     * button on a machine with two CLIs installed.
     */
    NEW_CONVERSATION: '.chat-conversation-head button:has(.anticon-plus)',
    SWITCHER: '.chat-conversation-list',
    CONVERSATION_SELECT: '.chat-conversation-select',
    /** The switcher's own dropdown; the panel holds other selects, and they open the same markup. */
    CONVERSATION_OPTION: '.chat-conversation-popup .ant-select-item-option',
    COLUMN: '.chat-column',
    PINNED_HEADER: '.chat-conversation-row--header',
    COMPOSER: '.chat-textarea',
};

/** antd puts the same aria-label on the icon inside a button, so the button is named explicitly. */
const action = (name: string) => `button[aria-label="${name}"]`;

/** Opens the switcher's dropdown and takes the conversation named. */
const selectConversation = async (page: Page, title: string) => {
    await page.locator(PANEL.CONVERSATION_SELECT).click();
    const option = page.locator(PANEL.CONVERSATION_OPTION, { hasText: title });
    await expect(option).toBeVisible({ timeout: TIMEOUT });
    await option.click();
};

interface Conversation {
    id: string;
    title: string;
    folder: string;
    model: string;
    effort: string;
    running: boolean;
    archived: boolean;
    pinned: boolean;
    messageCount: number;
}

interface ViewStateFile {
    version: number;
    global: Record<string, Record<string, unknown>>;
    folders: Record<string, unknown>;
    files: Record<string, unknown>;
}

const listConversations = async (): Promise<Conversation[]> => {
    const response = await fetch(`${workerApi()}/hybridflow-runner/conversations`);
    if (!response.ok) throw new Error(`GET /hybridflow-runner/conversations answered ${response.status}`);
    return response.json() as Promise<Conversation[]>;
};

const conversationIds = async (): Promise<string[]> => (await listConversations()).map(c => c.id);

const patchConversation = async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`${workerApi()}/hybridflow-runner/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`PATCH /hybridflow-runner/conversations/${id} answered ${response.status}`);
};

const readViewState = async (): Promise<ViewStateFile | null> => {
    const response = await fetch(`${workerApi()}/config/${VIEW_STATE_DOC}`);
    return response.ok ? response.json() as Promise<ViewStateFile> : null;
};

/**
 * The conversation the panel is on, read where the app is required to keep it: the shared
 * server-side view state. Which scope key holds it is the plugin's business — what this spec pins
 * is that it is *there*, and below, that it is nowhere in browser storage. Conversation ids are
 * self-identifying (`conv-<millis>-<hex>`), so the lookup needs no key name to be sure of what it
 * found.
 */
const activeConversationId = async (): Promise<string | null> => {
    const state = await readViewState();
    for (const scope of Object.values(state?.global ?? {})) {
        for (const value of Object.values(scope ?? {})) {
            if (typeof value === 'string' && value.startsWith('conv-')) return value;
        }
    }
    return null;
};

/**
 * Clicks the panel's create control and reports the conversation it made. The id is taken from the
 * registry rather than from the DOM because the registry is what every later step asserts against,
 * and reading it from both would let the two drift without the spec noticing.
 */
const createConversation = async (page: Page, known: Set<string>): Promise<string> => {
    await page.locator(PANEL.NEW_CONVERSATION).click();
    let created = '';
    await expect.poll(async () => {
        created = (await conversationIds()).find(id => !known.has(id)) ?? '';
        return created;
    }, { timeout: TIMEOUT }).not.toBe('');
    known.add(created);
    return created;
};

/**
 * antd renders a Popconfirm's buttons in a portal, Cancel first and the confirming one last. Which
 * word the confirming one carries is the caller's choice — `okText` is "Discard", "Yes" and
 * "Delete" in three different places in this repo — so its position is the stable handle, not its
 * label.
 */
const confirmPopconfirm = async (page: Page) => {
    const buttons = page.locator('.ant-popconfirm-buttons button');
    await expect(buttons.last()).toBeVisible({ timeout: TIMEOUT });
    await buttons.last().click();
};

/**
 * Opens the right column on the chat tab and returns the undo for both.
 *
 * Neither is a per-tab preference: whether the column is on and which tab it shows live in the
 * shared `dashboard-view-state.json` config document, so they arrive however the previous spec left
 * them — read, never assume — and they leak into the next one. Leaving the column on narrows the
 * editor for every spec that follows, which is enough to shift where a restored scroll offset
 * lands; that is the lesson commit `c19f4aa4` records.
 */
const openChatPanel = async (page: Page): Promise<() => Promise<void>> => {
    const column = page.locator(SELECTORS.RIGHT_COLUMN);
    // A column that is off is not drawn at all — there is no collapsed state to read a class from.
    const wasOff = await column.count() === 0;
    if (wasOff) {
        await page.locator(SELECTORS.RIGHT_TOGGLE).click();
    }
    await expect(column).toBeVisible({ timeout: TIMEOUT });

    const activeTab = page.locator(SELECTORS.ACTIVE_TAB_LABEL).first();
    await expect(activeTab).toBeAttached({ timeout: TIMEOUT });
    const previousTab = await activeTab.getAttribute('aria-label');

    // Scoped to the tab strip: the Configuration panel the column opens on lists the plugin under
    // this same title, and a bare label lookup finds that row as well as this tab.
    //
    // `exact` because a role name is matched as a *substring* otherwise, and the tab strip is open
    // to every plugin in the assembly — `hybridflow-ui` hangs "Node agents" in this same strip, and
    // a loose name is one rename away from picking up two tabs. Every tab here is named by a plugin
    // that knows nothing of this spec, so the name is taken whole — which is also why the undo
    // below does the same with a title it read off the strip rather than chose.
    await page.getByRole('tab', { name: TAB_TITLE, exact: true }).click();
    // Each tab carries a tooltip placed *below* it, which lands over the panel it just opened and
    // stays up while the pointer is on it — and the click that opened the tab is what left it
    // there. The first thing this spec reaches for is the plus button in the panel head, directly
    // underneath. Same move as `bookmarks.spec.ts` and `template-copy.spec.ts`, for the same
    // reason. Counted rather than asserted hidden: the one going and the one arriving are both in
    // the DOM for a frame, and two of them is a strict-mode violation rather than an answer.
    await page.mouse.move(0, 0);
    await expect(page.locator('.ant-tooltip:visible')).toHaveCount(0);
    await expect(page.locator(PANEL.ROOT)).toBeVisible({ timeout: TIMEOUT });

    return async () => {
        // Escape first. An open modal's mask swallows the tab click, and a failed run is precisely
        // when this undo runs with one still open.
        await page.keyboard.press('Escape');
        if (previousTab && previousTab !== TAB_TITLE) {
            await page.getByRole('tab', { name: previousTab, exact: true }).click();
        }
        if (wasOff) {
            await page.locator(SELECTORS.RIGHT_TOGGLE).click();
            await expect(column).toHaveCount(0);
        }
        await flushViewState(page);
    };
};

test.describe('Chat conversations', () => {
    /** Everything this spec created, so the net below removes it whatever the test did. */
    const created = new Set<string>();
    let restoreColumn: (() => Promise<void>) | null = null;

    // In a hook rather than at the end of the test, so a failure halfway through cannot leave the
    // column on for everything that runs after it.
    test.afterEach(async () => {
        const undo = restoreColumn;
        restoreColumn = null;
        if (undo) await undo();
    });

    test.afterAll(async () => {
        for (const id of created) {
            await fetch(`${workerApi()}/hybridflow-runner/conversations/${id}`, { method: 'DELETE' });
        }
    });

    test('disabled CLIs expose no auth, usage or conversation features', async ({ page }) => {
        const toolboxResponse = await fetch(`${workerApi()}/toolbox`);
        expect(toolboxResponse.ok).toBe(true);
        const toolbox = await toolboxResponse.json() as {
            components: { id: string; agent?: string; registered: boolean }[];
        };
        const clis = toolbox.components.filter(component => component.agent);
        expect(clis.map(cli => cli.agent).sort()).toEqual(['claude', 'codex', 'muse', 'opencode']);
        const register = async (ids: string[], enabled: boolean) => {
            const response = await fetch(`${workerApi()}/toolbox/registration`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, enabled }),
            });
            expect(response.ok).toBe(true);
        };
        try {
            await register(clis.map(cli => cli.id), false);
            const optionsResponse = await fetch(`${workerApi()}/hybridflow-runner/options`);
            expect(await optionsResponse.json()).toMatchObject({ agents: [] });
            for (const cli of clis) {
                const response = await fetch(`${workerApi()}/hybridflow-runner/usage?agent=${cli.agent}`);
                expect(response.status).toBe(404);
            }
            const authResponse = await fetch(`${workerApi()}/hybridflow-runner/auth/status`);
            expect(authResponse.status).toBe(404);

            const probes: string[] = [];
            page.on('request', request => {
                if (/\/hybridflow-runner\/(auth|usage)/.test(request.url())) probes.push(request.url());
            });
            await page.goto(FOLDER);
            await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: TIMEOUT });
            restoreColumn = await openChatPanel(page);
            await expect(page.getByText('No agent is enabled and available.', { exact: false })).toBeVisible();
            await expect(page.locator('.chat-login-banner')).toHaveCount(0);
            await expect(page.locator('.chat-conversation-head button')).toHaveCount(0);
            await expect(page.locator(PANEL.ROOT).getByRole('button', { name: /Send$/ })).toBeDisabled();

            await page.getByRole('tab', { name: 'Usage', exact: true }).click();
            await page.mouse.move(0, 0);
            await expect(page.locator('.chat-usage-tab--empty')).toBeVisible();
            await expect(page.locator('.chat-usage-section')).toHaveCount(0);
            expect(probes).toEqual([]);
            await page.getByRole('tab', { name: TAB_TITLE, exact: true }).click();
        } finally {
            for (const cli of clis) await register([cli.id], cli.registered);
        }
    });

    test('creates two conversations, switches between them, and deletes one', async ({ page }) => {
        const known = new Set(await conversationIds());

        await page.goto(FOLDER);
        await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: TIMEOUT });
        restoreColumn = await openChatPanel(page);

        // 1. Two conversations in the same folder. The folder is fixed at creation — it is the
        // CLI's working directory and the owner of the CLI's own transcript — so it is asserted
        // here and never patched afterwards.
        const idA = await createConversation(page, known);
        created.add(idA);
        const idB = await createConversation(page, known);
        created.add(idB);
        expect(idA).not.toBe(idB);

        const registry = await listConversations();
        for (const id of [idA, idB]) {
            expect(registry.find(c => c.id === id))
                .toMatchObject({ folder: FOLDER, running: false, archived: false, messageCount: 0 });
        }

        // 2. Name them from outside the browser. That is not a shortcut around a rename control: it
        // is the assertion that a conversation changed anywhere reaches every open socket, which is
        // what keeps a switcher left open in one tab honest about work done in another.
        await patchConversation(idA, { title: TITLE_A });
        await patchConversation(idB, { title: TITLE_B });

        const panel = page.locator(PANEL.ROOT);

        // 3. Switch between them. The active conversation is the kind of thing a user expects to
        // find as they left it, so it belongs in the shared view state rather than in component
        // state — and the round trip through the file is the only proof that it is there.
        await selectConversation(page, TITLE_A);
        await expect.poll(activeConversationId, { timeout: TIMEOUT }).toBe(idA);
        await selectConversation(page, TITLE_B);
        await expect.poll(activeConversationId, { timeout: TIMEOUT }).toBe(idB);

        // The state that replaced the old per-tab conversation buffer must not have left a copy
        // behind: two places to look is two places to disagree.
        const storedKeys = await page.evaluate(() =>
            [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
        expect(storedKeys.filter(k => /claude|chat|agent/i.test(k))).toEqual([]);

        // 4. Delete one. Only this service's record goes — the CLI's own session file under
        // ~/.claude/projects is not ours to purge — so what is asserted is the registry.
        // The actions act on whatever the select is showing, which is the one just switched to.
        await panel.locator(PANEL.SWITCHER).locator(action('Delete')).click();
        await confirmPopconfirm(page);

        await expect.poll(async () => {
            await page.locator(PANEL.CONVERSATION_SELECT).click();
            const gone = await page.locator(PANEL.CONVERSATION_OPTION, { hasText: TITLE_B }).count();
            await page.keyboard.press('Escape');
            return gone;
        }, { timeout: TIMEOUT }).toBe(0);
        await expect.poll(conversationIds, { timeout: TIMEOUT }).not.toContain(idB);
        expect(await conversationIds()).toContain(idA);
        created.delete(idB);
    });

    test('pins a conversation into a column of its own, and unpins it back into the list', async ({ page }) => {
        const known = new Set(await conversationIds());

        await page.goto(FOLDER);
        await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: TIMEOUT });
        restoreColumn = await openChatPanel(page);

        const idPinned = await createConversation(page, known);
        created.add(idPinned);
        const idListed = await createConversation(page, known);
        created.add(idListed);
        await patchConversation(idPinned, { title: TITLE_PINNED });
        await patchConversation(idListed, { title: TITLE_LISTED });

        // The column is left at whatever width it was found at. Two panes need more room than
        // its default and scroll sideways without it — which is what the resize handle is for, and
        // why it no longer stops at 800px — but the width lives in the shared view state and every
        // spec that follows inherits it, so it is not this one's to change.
        {
            // Counted against what is already there rather than against 1: the registry is shared
            // with every other spec, and a conversation one of them pinned is a column too.
            const panel = page.locator(PANEL.ROOT);
            const columns = panel.locator(PANEL.COLUMN);
            const before = await columns.count();

            await selectConversation(page, TITLE_PINNED);
            await panel.locator(PANEL.SWITCHER).locator(action('Pin')).click();

            // The record is what carries it, so every tab and the next session agree.
            await expect.poll(async () => (await listConversations()).find(c => c.id === idPinned)?.pinned,
                { timeout: TIMEOUT }).toBe(true);
            // The pinned one is not listed *and* shown: it left the list for its own column.
            await expect(columns).toHaveCount(before + 1);
            await expect(panel.locator(PANEL.PINNED_HEADER, { hasText: TITLE_PINNED })).toHaveCount(1);
            await page.locator(PANEL.CONVERSATION_SELECT).click();
            await expect(page.locator(PANEL.CONVERSATION_OPTION, { hasText: TITLE_PINNED })).toHaveCount(0);
            await page.keyboard.press('Escape');
            // Each column is a chat in its own right — box and all — which is what makes it worth a
            // column rather than a second list.
            await expect(panel.locator(PANEL.COMPOSER)).toHaveCount(before + 1);

            // Nothing about the arrangement is the browser's: a reload finds it as it was left.
            await flushViewState(page);
            await page.reload();
            await expect(page.locator(PANEL.ROOT)).toBeVisible({ timeout: TIMEOUT });
            await expect(page.locator(PANEL.COLUMN)).toHaveCount(before + 1, { timeout: TIMEOUT });

            // Unpinning gives the column back and puts the conversation where a reader left off:
            // in the list, and selected.
            await page.locator(PANEL.PINNED_HEADER, { hasText: TITLE_PINNED }).locator(action('Unpin')).click();
            await expect.poll(async () => (await listConversations()).find(c => c.id === idPinned)?.pinned,
                { timeout: TIMEOUT }).toBe(false);
            await expect(page.locator(PANEL.COLUMN)).toHaveCount(before);
            await expect.poll(activeConversationId, { timeout: TIMEOUT }).toBe(idPinned);
        }
    });
});
