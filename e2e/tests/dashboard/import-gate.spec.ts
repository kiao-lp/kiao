import { test, expect, APIRequestContext, Page, workerApi } from '../harness';

/**
 * E2E: the import gate — what a store considers sensitive, highlighted in the review of an upload.
 *
 * Four things have to line up and no unit test crosses all four: worker seeds
 * `kiao-user-config/import-gate/` into a store that has none, Dashboard reads that folder back over
 * the wire, the conversion produces the text the rules run against, and the reader paints and
 * walks what they find. So the spec drives it the way it is actually used — drop a message on the
 * upload zone and read what lights up — and it puts a category of its own in the folder, because
 * "some provisioned by KIAO, others custom" is only true if the second half works.
 */

const TIMEOUT = 10000;
const FOLDER = 'import-gate-demo';
const GATE = 'kiao-user-config/import-gate';
const CUSTOM = `${GATE}/e2e-custom.json`;

/** A message carrying the two things the bundled catalogue is proudest of catching. */
const LEAKY = [
    'From: ops@example.org',
    'To: alex@example.com',
    'Date: Tue, 03 Mar 2026 09:15:00 +0100',
    'Subject: Acces au serveur de recette',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Voici la cle: AKIA1234567890123456',
    'Le serveur repond sur 192.168.12.40 comme convenu.',
    '',
].join('\r\n');

/** And one that names nothing the gate looks for. */
const PLAIN = LEAKY
    .replace('Subject: Acces au serveur de recette', 'Subject: Compte rendu de reunion')
    .replace('Voici la cle: AKIA1234567890123456', 'La reunion a dure une heure.')
    .replace('Le serveur repond sur 192.168.12.40 comme convenu.', 'Rien de particulier a signaler.');

const uploadInto = async (page: Page, files: { name: string; body: string }[]) => {
    await page.locator('.kiao-upload-zone input[type="file"]:not([webkitdirectory])').setInputFiles(
        files.map(f => ({ name: f.name, mimeType: 'message/rfc822', buffer: Buffer.from(f.body) })));
};

const read = async (request: APIRequestContext, path: string): Promise<string> => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`);
    return response.ok() ? response.text() : '';
};

const exists = async (request: APIRequestContext, path: string): Promise<boolean> =>
    (await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`)).ok();

/**
 * What the browser is actually painting at one level, as strings.
 *
 * A rendered preview carries no `<mark>`: its DOM belongs to React, so the findings are handed to
 * the browser as ranges through the CSS Custom Highlight API. Chromium has it, which makes this the
 * one place the painting can be checked at all — and it checks the real thing rather than a class.
 */
const paintedAt = (page: Page, level: string): Promise<string[]> => page.evaluate((name) => {
    const highlight = (CSS as unknown as { highlights?: Map<string, Iterable<Range>> }).highlights?.get(name);
    return highlight ? Array.from(highlight).map(range => range.toString()) : [];
}, `gate-${level}`);

const openFolder = async (page: Page) => {
    await page.goto(FOLDER);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.kiao-upload-zone')).toBeVisible({ timeout: TIMEOUT });
};

const write = async (request: APIRequestContext, path: string, content: string) => {
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'application/json', buffer: Buffer.from(content) } },
    });
    expect(response.ok(), `writing ${path}`).toBeTruthy();
};

test.describe('the import gate', () => {
    test.beforeEach(async ({ request }) => {
        await request.post(`${workerApi()}/createFolder?path=${encodeURIComponent(FOLDER)}`);
    });

    test.afterEach(async ({ request }) => {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(FOLDER)}`);
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(CUSTOM)}`);
    });

    // The gate is store content, seeded by the service: it is in the file tree, editable, and
    // committed with the store. A store nobody has configured still has one.
    test('is seeded into the store as ordinary, editable content', async ({ request }) => {
        const listing = await (await request.get(`${workerApi()}/list?path=${encodeURIComponent(GATE)}`)).json() as { path: string }[];
        const names = listing.map(entry => entry.path.substring(entry.path.lastIndexOf('/') + 1));

        expect(names).toContain('secrets.json');
        expect(names).toContain('classified.json');
        expect(names).toContain('README.md');

        const secrets = await (await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(`${GATE}/secrets.json`)}`)).json();
        expect(secrets.criticality).toBe('critical');
        expect(secrets.matchers.length).toBeGreaterThan(5);
    });

    test('highlights what it finds in a document, and steps through it', async ({ page }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'acces.eml', body: LEAKY }, { name: 'reunion.eml', body: PLAIN }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        // 1. The counts come before the reading: the question is whether there is anything in here.
        //    A mail carries addresses in its own headers, so the medium count is the message being
        //    a message — it is the two levels above it that are about what was written in it.
        await page.getByTestId('upload-review-node-acces.eml').click();
        await expect(page.getByTestId('gate-count-critical')).toHaveText('1 critical', { timeout: TIMEOUT });
        await expect(page.getByTestId('gate-count-high')).toHaveText('1 high');
        await expect(page.getByTestId('gate-count-medium')).toContainText('medium');

        // 2. The key is painted where it sits, at its own level. The index is Markdown and so is
        //    rendered, which is why this asks the browser what it is highlighting rather than
        //    looking for an element of ours in a document that is not ours.
        await expect.poll(() => paintedAt(page, 'critical')).toEqual(['AKIA1234567890123456']);
        expect(await paintedAt(page, 'high')).toEqual(['192.168.12.40']);

        // 3. Narrowed to a level, the walk is that level's alone — and the navigator names the rule
        //    that caught what it is standing on.
        await page.getByTestId('gate-count-critical').click();
        await expect(page.getByTestId('gate-position')).toHaveText('1 found');
        await page.getByTestId('gate-next').click();
        await expect(page.getByTestId('gate-position')).toHaveText('1 / 1');
        await expect(page.getByTestId('gate-current')).toContainText('AWS access key id');

        await page.getByTestId('gate-count-critical').click(); // widened again
        await page.getByTestId('gate-count-high').click();
        await page.getByTestId('gate-next').click();
        await expect(page.getByTestId('gate-current')).toContainText('Private IPv4 address');

        // 4. And the message that says nothing of the sort has neither level in it.
        await page.getByTestId('upload-review-node-reunion.eml').click();
        await expect(page.getByTestId('gate-count-medium')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId('gate-count-critical')).toHaveCount(0);
        await expect(page.getByTestId('gate-count-high')).toHaveCount(0);

        await page.getByTestId('upload-review-cancel').click();
    });


    // The complaint this fixes was immediate and visual: the app's stylesheet paints every `pre` in
    // the code colour, so the whole preview came out red. It is a document and reads as one — in
    // the same ink as the dialog around it.
    test('reads in the dialog\u2019s own ink and not the code colour', async ({ page }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'notes.txt', body: 'une note tout \u00e0 fait ordinaire' }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });
        await page.getByTestId('upload-review-node-notes.txt').click();
        await expect(page.getByTestId('upload-review-index')).toContainText('ordinaire', { timeout: TIMEOUT });

        const ink = await page.getByTestId('upload-review-selected').evaluate(el => getComputedStyle(el).color);
        const paneInk = await page.getByTestId('upload-review-index').evaluate(el => getComputedStyle(el).color);
        expect(paneInk).toBe(ink);

        await page.getByTestId('upload-review-cancel').click();
    });

    // A note nobody had to convert is text, and text is what the gate is for. Reading only what a
    // converter touched would wave through the files whose secrets are in plain sight.
    test('runs over a text file nothing had to convert', async ({ page }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'cles.txt', body: 'la cle de prod est AKIA1234567890123456\n' }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-node-cles.txt').click();
        await expect(page.getByTestId('gate-count-critical')).toHaveText('1 critical', { timeout: TIMEOUT });
        await expect(page.getByTestId('upload-review-index').locator('mark', { hasText: 'AKIA1234567890123456' }))
            .toHaveCount(1);

        // And a decision is now demanded for it: Safe import waits on the text as it does on an index.
        await expect(page.getByTestId('upload-review-safe')).toBeDisabled();
        await page.getByTestId('upload-review-import').click();
        await expect(page.getByTestId('upload-review-safe')).toBeEnabled();

        await page.getByTestId('upload-review-cancel').click();
    });

    // An index is Markdown, and so is half of what anyone uploads. It is a document and is shown
    // as one — headings and lists, not hashes and hyphens.
    test('shows Markdown as a document rather than as its source', async ({ page }) => {
        await openFolder(page);
        await uploadInto(page, [{
            name: 'compte-rendu.md',
            body: '# Reunion du 3 mars\n\n- premier point\n- second point\n\nserveur 192.168.12.40\n',
        }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-node-compte-rendu.md').click();
        const pane = page.getByTestId('upload-review-index');
        await expect(pane.locator('h1')).toHaveText('Reunion du 3 mars', { timeout: TIMEOUT });
        await expect(pane.locator('li')).toHaveCount(2);
        await expect(pane).not.toContainText('# Reunion'); // the hashes are gone, not escaped

        // The gate still ran, over the source, and the navigator still walks what it found.
        await expect(page.getByTestId('gate-count-high')).toHaveText('1 high');
        await page.getByTestId('gate-next').click();
        await expect(page.getByTestId('gate-current')).toContainText('Private IPv4 address');

        await page.getByTestId('upload-review-cancel').click();
    });

    // The third answer: keep what the document says and let the document go. What lands is the
    // index under the file's own name, and the original is not in the store at all.
    test('imports a document as its text, and leaves the original behind', async ({ page, request }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'acces.eml', body: LEAKY }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-node-acces.eml').click();
        await page.getByTestId('upload-review-as-text').click();
        await expect(page.getByTestId('upload-review-node-acces.eml')).toContainText('text');
        await page.getByTestId('upload-review-safe').click();

        await expect(page.getByTestId(`browser-item-${FOLDER}/acces.eml.md`)).toBeVisible({ timeout: TIMEOUT });
        expect(await read(request, `${FOLDER}/acces.eml.md`)).toContain('Acces au serveur de recette');
        expect(await exists(request, `${FOLDER}/acces.eml`), 'the original went with the staging area').toBeFalsy();
        expect(await exists(request, `${FOLDER}/acces.eml.index.md`), 'and not under its index name').toBeFalsy();
    });

    // Obfuscating is not a note about a finding: it cuts the passage out of the file that lands.
    test('obfuscates a finding, and imports the text without it', async ({ page, request }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'cles.txt', body: 'la cle de prod est AKIA1234567890123456 (a garder)\n' }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-node-cles.txt').click();
        await expect(page.getByTestId('gate-count-critical')).toHaveText('1 critical', { timeout: TIMEOUT });

        await page.getByTestId('gate-next').click();
        await expect(page.getByTestId('gate-current')).toContainText('AWS access key id');
        await page.getByTestId('gate-obfuscate').click();

        // Gone from the pane and from the gate, at once.
        await expect(page.getByTestId('upload-review-index')).toContainText('la cle de prod est [...] (a garder)');
        await expect(page.getByTestId('gate-count-critical')).toHaveCount(0);

        await page.getByTestId('upload-review-import').click();
        await page.getByTestId('upload-review-safe').click();

        await expect(page.getByTestId(`browser-item-${FOLDER}/cles.txt`)).toBeVisible({ timeout: TIMEOUT });
        const imported = await read(request, `${FOLDER}/cles.txt`);
        expect(imported).toContain('[...]');
        expect(imported, 'the key is not in the store').not.toContain('AKIA1234567890123456');
    });

    // Half the point of the folder: a store adds the rules only it needs, in force at the next
    // upload, with no build and no reload.
    test('runs a category the store added itself', async ({ page, request }) => {
        await write(request, CUSTOM, JSON.stringify({
            category: 'e2e-custom',
            label: 'Dossiers de recette',
            criticality: 'high',
            matchers: [{ label: 'Numéro de dossier', pattern: 'DOSSIER-\\d{4}' }],
        }));

        await openFolder(page);
        await uploadInto(page, [{
            name: 'dossier.eml',
            body: PLAIN.replace('Rien de particulier a signaler.', 'Reference DOSSIER-4271 a traiter.'),
        }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-node-dossier.eml').click();
        await expect(page.getByTestId('gate-count-high')).toHaveText('1 high', { timeout: TIMEOUT });
        await page.getByTestId('gate-count-high').click(); // the store's own rule, and only it
        await page.getByTestId('gate-next').click();
        await expect(page.getByTestId('gate-current')).toContainText('Dossiers de recette · Numéro de dossier');
        await expect.poll(() => paintedAt(page, 'high')).toEqual(['DOSSIER-4271']);

        await page.getByTestId('upload-review-cancel').click();
    });
});
