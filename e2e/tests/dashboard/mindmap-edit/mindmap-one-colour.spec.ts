import { test, expect, APIRequestContext, Locator, Page, fileUrl, resetViewState, restoreFixture } from '../../harness';

/**
 * E2E: the one colour the map is being drawn in, chosen once for the three selectors that follow.
 *
 * A note's border, a note's fill and a relation are three choices saying the same word nearly
 * every time a map is coloured by hand — a run of red notes joined by red relations. So the bar
 * opens with a selector that sets all three, and the three stay where they are for the map that
 * wants its fill quiet and its ink loud. Picking from it moves them; moving one of them on its own
 * leaves it showing no colour, there being no single word for what is then being drawn.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

/** How many swatches a palette offers: the ten colours, and the plain look before them. */
const COLOURS = 11;

/** The one selector, and the three it sets — each named in the bar by what it does. */
const ONE_COLOUR = "One colour for a new note's border and background and a new relation";
const BORDER = 'Border colour of a new note';
const BACKGROUND = 'Background colour of a new note';
const RELATION = 'Colour of a new relation';

/**
 * The list that is open. antd leaves a closed list in the page for as long as its leave animation
 * lasts, so the one being read is the one that is neither hidden nor on its way out.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/** Opens one of the bar's selectors, there being no other list in the page for it to be read for. */
const open = async (page: Page, selector: string) => {
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator(`.cms-top-banner .ant-select[title="${selector}"]`).click();
    const popup = page.locator(OPEN_LIST);
    await expect(popup).toBeVisible({ timeout: TIMEOUT });
    return popup;
};

/** Picks from one of them, every option being named as well as drawn. */
const choose = async (page: Page, selector: string, option: string) => {
    const popup = await open(page, selector);
    const item = popup.locator(`.ant-select-item-option[title="${option}"]`);
    await item.click();
    // The list closes on a choice it heard. Under load it can still be sliding in when the
    // click lands, and the click lands beside its option with it — so a list left open is
    // asked once more (choosing the same option twice chooses it once), and only then is
    // its closing waited for rather than left to the next open's precondition.
    if (await page.locator(OPEN_LIST).count() > 0) await item.click();
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
};

/**
 * Holds a selector to the option it is showing as chosen — `null` for a selector showing none,
 * which is a state of its own here and not a failure.
 *
 * Written as assertions rather than as a value read and then compared, because what is being read
 * is a list that has just been opened: the options are drawn, the mark of being chosen is applied,
 * and a single read taken between the two says the selector is showing nothing. Both of these
 * wait, so what they hold is what the list settles at rather than which frame it was caught in.
 */
const expectChosen = async (page: Page, selector: string, option: string | null) => {
    const popup = await open(page, selector);
    await expect(popup.locator('.ant-select-item-option')).toHaveCount(COLOURS, { timeout: TIMEOUT });

    const selected = popup.locator('.ant-select-item-option-selected');
    if (option === null) {
        await expect(selected, selector).toHaveCount(0, { timeout: TIMEOUT });
    } else {
        await expect(selected, selector).toHaveAttribute('title', option, { timeout: TIMEOUT });
    }

    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden({ timeout: TIMEOUT });
};

/** Pulls a relation out of one note and lets it go over another, which is shift and a drag. */
const relate = async (page: Page, from: Locator, to: Locator) => {
    const start = (await from.boundingBox())!;
    const end = (await to.boundingBox())!;

    await page.keyboard.down('Shift');
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
};

/**
 * What the store actually holds of the colour, as a count of each thing drawn in it.
 *
 * The editor writes on a debounce and this spec draws twice, so the file passes through a state
 * that holds the note and not yet the relation. Waiting for a write to land — any write — is
 * waiting for that state as often as for the last one, and the reload then opens half of what was
 * drawn. Polling what is in the file is waiting for the write that matters.
 */
const drawnInTeal = async (request: APIRequestContext) => {
    const { content } = await (await request.fetch(fileUrl(FILE))).json();
    const { notes, relations } = content.elements;
    return {
        notes: notes.filter((note: any) => note.borderColor === 'teal' && note.background === 'teal').length,
        relations: relations.filter((relation: any) => relation.color === 'teal').length
    };
};

/** This spec draws a note and a relation on the map, and every spec of it starts from the fixture. */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
});

/** The style the bar is set to is remembered app-wide, so this spec puts it back. */
test.afterEach(resetViewState);

test('mindmap: one colour in the top bar sets the border, the fill and the relation alike', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    // The first navigation of a run waits on the plugins being compiled and loaded.
    await expect(mindmap).toBeVisible({ timeout: 4 * TIMEOUT });
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Leave VISUALIZE mode, where the bare map is neither pulled from nor double-clicked into.
    await mindmap.click({ position: { x: 20, y: 20 } });

    // A map that has been told nothing is drawn in the plain look, and the selector says so.
    await expectChosen(page, ONE_COLOUR, 'Default');

    await choose(page, ONE_COLOUR, 'Teal');

    // The one choice is the three: the selectors it stands for have moved with it.
    await expectChosen(page, BORDER, 'Teal');
    await expectChosen(page, BACKGROUND, 'Teal');
    await expectChosen(page, RELATION, 'Teal');

    // And what is drawn next is drawn in it — the note left on the bare map, and the relation
    // pulled between two notes, in one colour without either having been coloured on its own.
    //
    // A note is made by double clicking the bare map where it should sit, clear of the three the
    // fixture holds, which stand to the right of here.
    await mindmap.dblclick({ position: { x: 60, y: 240 } });
    await expect(mindmap.locator('.note-border-teal')).toHaveCount(1, { timeout: TIMEOUT });
    await expect(mindmap.locator('.note-bg-teal')).toHaveCount(1);

    // The note made opens for editing, which is left by clicking the map rather than by Escape —
    // the dispatcher is off while a note is being edited (see mindmap-notes.spec.ts). The click
    // also takes the pointer off what it was last over, which is what a double click on the bare
    // map wants: over an element it belongs to that element and drops no note.
    await mindmap.click({ position: { x: 10, y: 10 } });

    await relate(page,
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note One' }),
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note Three' }));
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(3, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-color-teal')).toHaveCount(1);

    // One of the three moved on its own, and there is no longer a single colour to show: the
    // selector holds none rather than claiming one that only two of the three are set to. What it
    // stands for is untouched — it is a way of setting the three, not a fourth thing they follow.
    await choose(page, BACKGROUND, 'Pink');
    await expectChosen(page, BACKGROUND, 'Pink');
    await expectChosen(page, BORDER, 'Teal');
    await expectChosen(page, RELATION, 'Teal');
    await expectChosen(page, ONE_COLOUR, null);

    // What was drawn opens again: the colour is written onto the note and onto the relation.
    await expect.poll(() => drawnInTeal(request), { timeout: TIMEOUT }).toEqual({ notes: 1, relations: 1 });
    await page.reload();
    await expect(page.locator('.mindmap .relation-color-teal')).toHaveCount(1, { timeout: 4 * TIMEOUT });
    await expect(page.locator('.mindmap .note-border-teal')).toHaveCount(1);
    await expect(page.locator('.mindmap .note-bg-teal')).toHaveCount(1);

    expect(pageErrors).toEqual([]);
});
