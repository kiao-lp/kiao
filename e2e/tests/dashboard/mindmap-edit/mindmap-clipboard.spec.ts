import { test, expect, APIRequestContext, Page, workerApi } from '../../harness';

/**
 * E2E: a piece of one map copied, cut and pasted into another.
 *
 * What is written on the clipboard and what is made of it are unit-tested in
 * `lib/mindmap-clipboard.spec.ts`; what only the running app can show is the journey itself — a
 * real system clipboard, written by Ctrl+C in one document and read by Ctrl+V in another, which is
 * how a piece of a map is carried between two instances of KIAO.
 *
 * It is also where the crash this was built for is held down. Copy used to file every element it
 * took under `notes` whatever it was, so a relation was pasted where a note is drawn: the editor
 * threw on the first render — "e is not iterable", the note's bounds being destructured out of
 * nothing — and the file it had saved could no longer be opened at all. The last test here opens
 * exactly such a file.
 *
 * Every map is seeded through the files API, so a run leaves the fixtures as it found them.
 */

const TIMEOUT = 15000;

// The clipboard is the only thing two maps in two tabs share, which is the whole point of it.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const SOURCE = 'folder-a/clipboard-source.mmap.json';
const TARGET = 'folder-a/clipboard-target.mmap.json';
const MISFILED = 'folder-a/clipboard-misfiled.mmap.json';

const note = (id: string, title: string, at: [number, number]) => ({
    id,
    userBounds: [at[0], at[1], null, null],
    bounds: [at[0], at[1], 120, 60],
    content: `# ${title}`,
    zIndex: 3
});

const relation = (id: string, from: string, to: string) => ({
    id,
    ends: [{ id: `END-${id}-a`, target: from }, { id: `END-${id}-b`, target: to }]
});

const mindmapDocument = (elements: object) => JSON.stringify({
    content: { elements },
    docType: 'QuickMindmap',
    docId: `e2e-${Math.random().toString(36).slice(2)}`,
    docTypeVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z'
});

const write = async (request: APIRequestContext, path: string, content: string) => {
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: {
            file: { name: path.split('/').pop()!, mimeType: 'application/json', buffer: Buffer.from(content) }
        }
    });
    expect(response.ok(), `seeding ${path}`).toBeTruthy();
};

/** The elements of the map that file holds — what every assertion about what was saved is about. */
const elementsIn = async (request: APIRequestContext, path: string) => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`);
    return JSON.parse(await response.text()).content.elements as {
        notes: { id: string }[], relations: { id: string, ends: { target: string }[] }[]
    };
};

const idsIn = async (request: APIRequestContext, path: string) => {
    const { notes, relations } = await elementsIn(request, path);
    return { notes: notes.map(element => element.id), relations: relations.map(element => element.id) };
};

/** Three notes and the two relations joining them: what every test here copies out of. */
const seedSource = (request: APIRequestContext) => write(request, SOURCE, mindmapDocument({
    notes: [
        note('NOTE-one', 'Note One', [200, 200]),
        note('NOTE-two', 'Note Two', [460, 200]),
        note('NOTE-three', 'Note Three', [460, 420])
    ],
    relations: [
        relation('REL-one-two', 'NOTE-one', 'NOTE-two'),
        relation('REL-two-three', 'NOTE-two', 'NOTE-three')
    ]
}));

/** Opens a map and puts it into EDIT, which is a click where there is no element. */
const openForEditing = async (page: Page, path: string) => {
    await page.goto(path);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await mindmap.click({ position: { x: 20, y: 20 } });
    await expect(mindmap).toHaveClass(/mindmap-edit/, { timeout: TIMEOUT });
    return mindmap;
};

/** Picks a note out without opening it: a plain click on one is how it is edited. */
const pickOut = async (page: Page, title: string) => {
    const box = (await page.locator('.mindmap .mindmap-rect').filter({ hasText: title }).boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Control');
};

/** A button of the dialog a cut opens, and of nothing else on the page. */
const modalButton = (page: Page, name: string) =>
    page.locator('.ant-modal').getByRole('button', { name, exact: true });

/** The map on the clipboard, or nothing at all while what is on it is still something else. */
const copiedMap = async (page: Page) => {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    try {
        return JSON.parse(text).elements as { notes: { id: string }[], relations: { id: string }[] };
    } catch {
        return null;
    }
};

test('mindmap: notes and the relation between them travel through the clipboard to another map', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await seedSource(request);
    await write(request, TARGET, mindmapDocument({ notes: [], relations: [] }));

    const mindmap = await openForEditing(page, SOURCE);
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // The two notes at either end of one relation. A box drawn round them picks out the notes and
    // never the relation — relations are not rectangles — so the copy takes it unasked.
    await pickOut(page, 'Note One');
    await pickOut(page, 'Note Two');
    await expect(mindmap.locator('.selected')).toHaveCount(2, { timeout: TIMEOUT });

    await page.keyboard.press('Control+c');

    await expect.poll(async () => (await copiedMap(page))?.notes.map(element => element.id),
        { timeout: TIMEOUT }).toEqual(['NOTE-one', 'NOTE-two']);
    expect((await copiedMap(page))!.relations.map(element => element.id)).toEqual(['REL-one-two']);

    // Into the other map, where nothing of this is known but what the clipboard carries.
    const target = await openForEditing(page, TARGET);
    await page.keyboard.press('Control+v');

    await expect(target.getByText('Note One')).toBeVisible({ timeout: TIMEOUT });
    await expect(target.getByText('Note Two')).toBeVisible();
    await expect(target.locator('.relation-anchor')).toHaveCount(1);

    // And in the file, under names of their own: a copy is a new note rather than the note it was
    // made from, so pasting one piece twice never gives a map two elements of one id.
    await expect.poll(async () => (await idsIn(request, TARGET)).notes.length, { timeout: TIMEOUT }).toBe(2);

    const { notes, relations } = await elementsIn(request, TARGET);
    expect(notes.map(element => element.id)).not.toContain('NOTE-one');
    expect(relations).toHaveLength(1);
    expect(relations[0].ends.map(end => end.target).sort())
        .toEqual(notes.map(element => element.id).sort());

    // The saved map opens again, which a relation drawn as a note made impossible.
    await page.reload();
    await expect(page.locator('.mindmap').getByText('Note One')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap .relation-anchor')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
});

test('mindmap: a relation whose other note stayed behind is not pasted', async ({ page, request }) => {
    await seedSource(request);
    await write(request, TARGET, mindmapDocument({ notes: [], relations: [] }));

    const mindmap = await openForEditing(page, SOURCE);
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Note Two is at one end of both relations; neither note at the other end comes along.
    await pickOut(page, 'Note Two');
    await expect(mindmap.locator('.selected')).toHaveCount(1, { timeout: TIMEOUT });
    await page.keyboard.press('Control+c');
    await expect.poll(async () => (await copiedMap(page))?.notes.map(element => element.id),
        { timeout: TIMEOUT }).toEqual(['NOTE-two']);

    const target = await openForEditing(page, TARGET);
    await page.keyboard.press('Control+v');

    await expect(target.getByText('Note Two')).toBeVisible({ timeout: TIMEOUT });
    await expect(target.locator('.relation-anchor')).toHaveCount(0);
    await expect.poll(async () => {
        const { notes, relations } = await idsIn(request, TARGET);
        return { notes: notes.length, relations: relations.length };
    }, { timeout: TIMEOUT }).toEqual({ notes: 1, relations: 0 });
});

test('mindmap: a cut asks before taking anything away, and takes it only when told to', async ({ page, request }) => {
    await seedSource(request);

    const mindmap = await openForEditing(page, SOURCE);
    await pickOut(page, 'Note Three');
    await expect(mindmap.locator('.selected')).toHaveCount(1, { timeout: TIMEOUT });

    // Refused: the map is left as it was, and the piece is on the clipboard all the same — which
    // is a copy. The Delete key asks nothing, so only a cut can bring this dialog up.
    await page.keyboard.press('Control+x');
    await expect(page.getByTestId('cut-confirm-message')).toBeVisible({ timeout: TIMEOUT });
    await modalButton(page, 'Keep').click();

    await expect(page.getByTestId('cut-confirm-message')).toHaveCount(0);
    await expect(mindmap.getByText('Note Three')).toBeVisible();
    await expect.poll(async () => (await copiedMap(page))?.notes.map(element => element.id),
        { timeout: TIMEOUT }).toEqual(['NOTE-three']);

    // Approved: the note goes, and the relation that reached it goes with it, as a delete does.
    // The note is still the one picked out — refusing a cut changes nothing at all.
    await expect(mindmap.locator('.selected')).toHaveCount(1);
    await page.keyboard.press('Control+x');
    await expect(page.getByTestId('cut-confirm-message')).toBeVisible({ timeout: TIMEOUT });
    await modalButton(page, 'Delete').click();

    await expect(mindmap.getByText('Note Three')).toHaveCount(0);
    await expect.poll(async () => await idsIn(request, SOURCE), { timeout: TIMEOUT })
        .toEqual({ notes: ['NOTE-one', 'NOTE-two'], relations: ['REL-one-two'] });
});

/**
 * The file the broken copy left behind: a relation filed among the notes, reaching notes that are
 * not in the map at all. Opening it threw before anything was drawn, and threw again on every
 * attempt after that — so it is not enough for the copy to be fixed; a map already in this state
 * has to open.
 */
test('mindmap: a map holding a relation among its notes opens, and is put right', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await write(request, MISFILED, mindmapDocument({
        notes: [
            note('NOTE-kept', 'Still here', [200, 200]),
            relation('REL-misfiled', 'NOTE-gone', 'NOTE-also-gone')
        ],
        relations: []
    }));

    const mindmap = await openForEditing(page, MISFILED);

    await expect(mindmap.getByText('Still here')).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    // And the map put right is what the next save writes, so the file stops being one that could
    // not be opened. Any edit at all does it; a note nudged with an arrow key is the smallest.
    await pickOut(page, 'Still here');
    await expect(mindmap.locator('.selected')).toHaveCount(1, { timeout: TIMEOUT });
    await page.keyboard.press('ArrowRight');

    await expect.poll(async () => await idsIn(request, MISFILED), { timeout: TIMEOUT })
        .toEqual({ notes: ['NOTE-kept'], relations: [] });
});
