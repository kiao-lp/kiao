import { test, expect, Page, resetViewState, awaitWrite, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: relations gathered with control, styled in one gesture, and deleted in one key.
 *
 * A relation is picked out by pressing its centre, and control gathers several of them exactly as
 * it gathers notes — so a run of relations already drawn can be handed the style the top bar
 * holds, by the brush beside it, rather than visited one menu at a time. What is gathered is
 * deleted together too: the Delete key takes the whole selection, notes and relations alike,
 * where it used to take only the single element the map was on.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

/**
 * The list that is open.
 *
 * antd does not take a closed list out of the page: it plays a leave animation over it, and for as
 * long as that lasts the list still has a box and still carries every class it had. So the one
 * being read is the one that is neither hidden nor on its way out — anything looser matches two
 * lists at once, which Playwright reports as a strict-mode violation rather than as a wait.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/** Picks from one of the bar's selectors, each of which is named by what it sets. */
const choose = async (page: Page, selector: string, option: string) => {
    // Opened onto a page showing no list, so the one that comes up is the only one there.
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator(`.mindmap-panel .ant-select[title="${selector}"]`).click();
    await page.locator(OPEN_LIST)
        .locator(`.ant-select-item-option[title="${option}"]`).click();
};

/** Where the map starts from, so a write of the editor's own can be waited for by its time. */
let restoredAt = 0;

/**
 * Five specs drive this map and every one of them writes it — a note deleted, a relation added, a
 * bend saved. A worker runs them one after another in one store, so each starts from the fixture
 * rather than from whatever the last of them left behind.
 */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
    restoredAt = await modifiedAt(request, FILE);
});

/** The bar's style is remembered app-wide rather than with the map, so this spec puts it back. */
test.afterEach(resetViewState);

test('mindmap: relations are gathered with control, styled together and deleted together', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // One anchor per relation: One—Two and Two—Three.
    const anchors = mindmap.locator('.relation-anchor');
    await expect(anchors).toHaveCount(2, { timeout: TIMEOUT });
    const selectedRelations = mindmap.locator('.selected .relation');

    // Leave VISUALIZE mode by clicking where there is no element.
    await mindmap.click({ position: { x: 20, y: 20 } });

    // Control gathers the two relations one at a time, and takes one back out again: pressing
    // what is already gathered is what drops it, exactly as it is on a note.
    await anchors.first().click({ modifiers: ['Control'] });
    await expect(selectedRelations).toHaveCount(1, { timeout: TIMEOUT });
    await anchors.nth(1).click({ modifiers: ['Control'] });
    await expect(selectedRelations).toHaveCount(2);
    await anchors.nth(1).click({ modifiers: ['Control'] });
    await expect(selectedRelations).toHaveCount(1);
    await anchors.nth(1).click({ modifiers: ['Control'] });
    await expect(selectedRelations).toHaveCount(2);

    // Gathering opens no menu: a relation held with others is being worked on with them.
    await expect(page.locator('.relation-context-menu')).toHaveCount(0);

    // And a note joins them, notes and relations being one selection — which is why one colour
    // has to say of both that they are in it: the halo a relation is ringed with is the very
    // colour the note is ringed in. Read off the page, the accent being the theme's to choose.
    const noteOne = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note One' });
    await noteOne.click({ modifiers: ['Control'] });
    const selectedNotes = mindmap.locator('.selected .mindmap-rect');
    await expect(selectedNotes).toHaveCount(1, { timeout: TIMEOUT });

    const ringOfNote = await selectedNotes.evaluate(el => getComputedStyle(el).outlineColor);
    const ringOfRelation = await mindmap.locator('.selected .relation-halo').first()
        .evaluate(el => getComputedStyle(el).stroke);
    expect(ringOfRelation).toBe(ringOfNote);

    // The note drops out again: what the brush below is aimed at is the two relations.
    await noteOne.click({ modifiers: ['Control'] });
    await expect(selectedNotes).toHaveCount(0);

    // The style the bar is set to, handed to both of them at once by the brush beside it. Two
    // lines become two rectangles in that colour — a body drawn at each of a relation's two ends.
    await expect(mindmap.locator('.relation-body')).toHaveCount(0);
    await choose(page, 'Body of a new relation', 'Rectangle');
    await choose(page, 'Body width of a new relation', '32');
    await choose(page, 'Colour of a new relation', 'Violet');
    await expect(mindmap.locator('.relation-body')).toHaveCount(0);

    await page.locator('.cms-top-banner')
        .getByTitle('Apply this style to the selected relations').click();

    await expect(mindmap.locator('.relation-body')).toHaveCount(4, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-color-violet')).toHaveCount(2);

    // What was styled opens again: the brush writes onto the relations, as widths and a colour.
    await awaitWrite(request, FILE, restoredAt);
    await page.reload();
    await expect(mindmap.locator('.relation-body')).toHaveCount(4, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-color-violet')).toHaveCount(2);

    // A mark of its own for what follows: the map has moved since the fixture, so the time to
    // wait past is the one it stands at now.
    const styledAt = await modifiedAt(request, FILE);

    // And the Delete key takes everything gathered: both relations at once, the notes they ran
    // between staying where they are.
    await mindmap.click({ position: { x: 20, y: 20 } });
    await anchors.first().click({ modifiers: ['Control'] });
    await anchors.nth(1).click({ modifiers: ['Control'] });
    await expect(selectedRelations).toHaveCount(2, { timeout: TIMEOUT });
    await page.keyboard.press('Delete');

    await expect(anchors).toHaveCount(0, { timeout: TIMEOUT });
    await expect(mindmap.locator('.mindmap-rect')).toHaveCount(3);

    // Notes go the same way — the key reads a selection, not one element at a time.
    const noteTwo = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note Two' });
    await noteOne.click({ modifiers: ['Control'] });
    await noteTwo.click({ modifiers: ['Control'] });
    await expect(selectedNotes).toHaveCount(2, { timeout: TIMEOUT });
    await page.keyboard.press('Delete');

    await expect(mindmap.getByText('Note One')).toHaveCount(0);
    await expect(mindmap.getByText('Note Two')).toHaveCount(0);
    await expect(mindmap.getByText('Note Three')).toBeVisible();

    // What was deleted stays deleted, and the map still opens.
    await awaitWrite(request, FILE, styledAt);
    await page.reload();
    await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap').getByText('Note Three')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap .mindmap-rect')).toHaveCount(1);

    expect(pageErrors).toEqual([]);
});
