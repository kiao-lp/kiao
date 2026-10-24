import { test, expect, fileUrl } from '../harness';

/**
 * E2E: edit an archdia diagram embedded in a markdown document.
 *
 * A diagram written as a fenced ```archdia block in a `.md` file is drawn in the
 * preview as a picture, like every other diagram language; the edit button hands
 * it to the full archdia editor, and validating splices the new diagram back into
 * that block — leaving the rest of the document alone — where the markdown
 * editor's autosave picks it up.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/diagram-in-markdown.md';

/** Open the nth rendered diagram in the editor dialog. */
const openDiagramEditor = async (page: import('../harness').Page, index: number) => {
    await expect(page.locator('.archdia-svg').nth(index)).toBeVisible({ timeout: TIMEOUT });

    // The edit button lives with the copy button, revealed on hover.
    await page.locator('.code-block-wrapper').nth(index).hover();
    await page.locator('.code-edit-btn').nth(index).click();

    const dialog = page.getByRole('dialog', { name: 'Edit diagram' });
    await expect(dialog.locator('.archdia-toolbar')).toBeVisible({ timeout: TIMEOUT });
    return dialog;
};

test('edits the diagram that was clicked and writes it back into the markdown', async ({ page, request }) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // Drawn as a picture in the document: the artboard and its instruments are
    // the editor's, and the dialog is where they belong.
    await expect(page.locator('.archdia-svg')).toHaveCount(2, { timeout: TIMEOUT });
    await expect(page.locator('.archdia-toolbar')).toHaveCount(0);

    // The block offers what the other diagram blocks offer — copy source, copy
    // image — plus the edit button.
    const firstBlock = page.locator('.code-block-wrapper').first();
    await firstBlock.hover();
    await expect(firstBlock.locator('.svg-copy-btn')).toBeVisible();

    // The second of two identical-looking blocks: proves the edit is anchored to
    // the block the reader clicked rather than to the first one that matches.
    const dialog = await openDiagramEditor(page, 1);
    await expect(dialog).toContainText('Gamma Component');

    // Change the diagram size — a toolbar action whose result is visible in the
    // block's LAYOUT section once written back.
    await dialog.locator('.archdia-toolbar-size-label').click();
    await dialog.locator('.archdia-toolbar-size-option', { hasText: 'Large (1280×960)' }).click();

    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    // The source pane shows the rewritten block…
    await expect(page.locator('.cm-content').first()).toContainText('1280', { timeout: TIMEOUT });

    // …and the autosaved file kept everything around that block intact, with the
    // fence still long enough to contain the block's own ``` fences.
    await expect(async () => {
        const saved = await (await request.get(fileUrl(FILE))).text();
        expect(saved).toContain('"width": 1280');
        expect(saved).toContain('A prose paragraph before the diagram.');
        expect(saved).toContain('A prose paragraph between the diagrams.');
        expect(saved).toContain('A prose paragraph after the diagram.');
        expect(saved).toContain('````archdia');
        expect(saved).toContain('```plantuml');
        // The first diagram is untouched: still 640 wide, still its own components.
        expect(saved).toContain('Alpha Component');
        expect(saved).toContain('"width": 640');
        expect(saved.indexOf('"width": 640')).toBeLessThan(saved.indexOf('"width": 1280'));
    }).toPass({ timeout: TIMEOUT });

    // A cold load still renders two diagrams — neither block was broken up.
    await page.reload();
    await expect(page.locator('.archdia-svg')).toHaveCount(2, { timeout: TIMEOUT });
});

test('leaves the document untouched when the dialog is cancelled', async ({ page, request }) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const before = await (await request.get(fileUrl(FILE))).text();

    const dialog = await openDiagramEditor(page, 0);
    await dialog.locator('.archdia-toolbar-size-label').click();
    await dialog.locator('.archdia-toolbar-size-option', { hasText: 'Wide (1600×900)' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    // Past the 1s autosave debounce: a cancelled edit must never reach the file.
    await page.waitForTimeout(1500);
    expect(await (await request.get(fileUrl(FILE))).text()).toBe(before);
});

/**
 * A `mermaid` or `plantuml` block is editable too, by converting it to archdia
 * first: the editor only speaks archdia, so applying replaces the original block
 * with its converted version rather than writing archdia under the old fence.
 */
const CONVERT_FILE = 'smoke/diagram-convert.md';

/** Open the nth block in the editor dialog, whatever language its fence declares. */
const openBlockEditor = async (page: import('../harness').Page, index: number) => {
    await page.locator('.code-block-wrapper').nth(index).hover();
    await page.locator('.code-edit-btn').nth(index).click();

    const dialog = page.getByRole('dialog', { name: 'Edit diagram' });
    await expect(dialog.locator('.archdia-toolbar')).toBeVisible({ timeout: TIMEOUT });
    return dialog;
};

test('converts a mermaid block to archdia and writes the converted block back', async ({ page, request }) => {
    await page.goto(CONVERT_FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.code-block-wrapper').first()).toBeVisible({ timeout: TIMEOUT });

    const dialog = await openBlockEditor(page, 0);

    // The title says which block is being converted…
    await expect(dialog).toContainText('converting from mermaid');
    // …and the mermaid diagram came through as an archdia scene.
    await expect(dialog).toContainText('Alpha Component');
    await expect(dialog).toContainText('Beta Component');

    await dialog.getByRole('button', { name: 'Convert & apply' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    await expect(async () => {
        const saved = await (await request.get(fileUrl(CONVERT_FILE))).text();
        // The fence is retagged and grew to hold the archdia sections' own fences
        expect(saved).toContain('````archdia');
        expect(saved).not.toContain('```mermaid');
        expect(saved).toContain('rectangle "Alpha Component" as Alpha');
        expect(saved).toContain('Alpha --> Beta');
        expect(saved).toContain('type: LAYOUT');
        // Everything around the converted block is untouched, plantuml included
        expect(saved).toContain('A prose paragraph before the diagrams.');
        expect(saved).toContain('A prose paragraph between the diagrams.');
        expect(saved).toContain('A prose paragraph after the diagrams.');
        expect(saved).toContain('```plantuml');
    }).toPass({ timeout: TIMEOUT });

    // A cold load renders the converted block as a diagram rather than as code
    await page.goto(CONVERT_FILE);
    await expect(page.locator('.code-block-wrapper').first().locator('.archdia-svg'))
        .toBeVisible({ timeout: TIMEOUT });
});

test('converts a plantuml block to archdia, keeping its source verbatim', async ({ page, request }) => {
    await page.goto(CONVERT_FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.code-block-wrapper').nth(1)).toBeVisible({ timeout: TIMEOUT });

    // The second block — the first is the mermaid one the previous test converted
    const dialog = await openBlockEditor(page, 1);
    await expect(dialog).toContainText('converting from plantuml');
    await expect(dialog.locator('.archdia-svg')).toContainText('Gamma Component');

    await dialog.getByRole('button', { name: 'Convert & apply' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    await expect(async () => {
        const saved = await (await request.get(fileUrl(CONVERT_FILE))).text();
        // Wrapped in archdia sections, but the PlantUML itself is carried over as-is
        expect(saved).toContain(
            '````archdia\n---\ntype: PLANTUML\n---\n```plantuml\n@startuml\ncomponent "Gamma Component" as Gamma',
        );
        expect(saved).toContain('Gamma --> Delta');
    }).toPass({ timeout: TIMEOUT });

    await page.goto(CONVERT_FILE);
    await expect(page.locator('.code-block-wrapper').nth(1).locator('.archdia-svg'))
        .toBeVisible({ timeout: TIMEOUT });
});

/**
 * The way back out: an archdia block gives up the `plantuml` diagram it holds.
 * Nothing is translated — the wrapper around the source is simply dropped — so
 * the dialog shows what will be written before anything is, and a block holding
 * several diagrams asks which one rather than guessing.
 */
const EXTRACT_FILE = 'smoke/diagram-extract.md';

/** The blocks offering an extract button — the archdia ones, and only those. */
const extractableBlocks = (page: import('../harness').Page) =>
    page.locator('.code-block-wrapper').filter({ has: page.locator('.code-extract-btn') });

const openExtractDialog = async (
    page: import('../harness').Page,
    block: import('../harness').Locator,
) => {
    await expect(page.locator('.archdia-svg').first()).toBeVisible({ timeout: TIMEOUT });

    // The extract button lives with the copy and edit buttons, revealed on hover.
    await block.hover();
    await block.locator('.code-extract-btn').click();

    const dialog = page.getByRole('dialog', { name: 'Extract diagram' });
    await expect(dialog.locator('.archdia-extract-preview')).toBeVisible({ timeout: TIMEOUT });
    return dialog;
};

test('extracts the diagram an archdia block holds', async ({ page, request }) => {
    await page.goto(EXTRACT_FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    const dialog = await openExtractDialog(page, extractableBlocks(page).first());

    // A single-diagram block has nothing to choose
    await expect(dialog).toContainText('The archdia block is replaced');
    await expect(dialog.getByText('Which diagram')).toHaveCount(0);
    await expect(dialog.locator('.archdia-extract-preview')).toContainText('@startuml');

    await dialog.getByRole('button', { name: 'Extract' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    await expect(async () => {
        const saved = await (await request.get(fileUrl(EXTRACT_FILE))).text();
        // The source comes out untouched, under a plain fence now that the block
        // no longer holds fences of its own
        expect(saved).toContain(
            '```plantuml\n@startuml\ncomponent "Alpha Component" as Alpha\n'
            + 'component "Beta Component" as Beta\nAlpha --> Beta\n@enduml\n```',
        );
        // The archdia wrapper is gone from that block only
        expect(saved).not.toContain('"Alpha": {');
        expect(saved).toContain('Base layer');
        expect(saved).toContain('A prose paragraph before the diagrams.');
        expect(saved).toContain('A prose paragraph between the diagrams.');
        expect(saved).toContain('A prose paragraph after the diagrams.');
    }).toPass({ timeout: TIMEOUT });

    // A cold load renders the extracted block as a plantuml diagram
    await page.goto(EXTRACT_FILE);
    await expect(page.locator('.code-block-wrapper').first().locator('img'))
        .toBeVisible({ timeout: TIMEOUT });
});

test('asks which diagram a multi-layer block should give up', async ({ page, request }) => {
    await page.goto(EXTRACT_FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // The two-layer block, whichever rank it now holds in the document
    const dialog = await openExtractDialog(page, extractableBlocks(page).last());

    // Each layer is offered under the name its block gives it, the first opened
    await expect(dialog.getByText('Which diagram')).toBeVisible();
    await expect(dialog.locator('.archdia-extract-preview')).toContainText('Gamma Component');

    await dialog.getByRole('radio', { name: 'Detail layer' }).click();
    await expect(dialog.locator('.archdia-extract-preview')).toContainText('Delta Component');
    await expect(dialog.locator('.archdia-extract-preview')).not.toContainText('Gamma Component');

    await dialog.getByRole('button', { name: 'Extract' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    await expect(async () => {
        const saved = await (await request.get(fileUrl(EXTRACT_FILE))).text();
        // Only the chosen layer comes out, under a plain plantuml fence
        expect(saved).toContain('```plantuml\n@startuml\ncomponent "Delta Component" as Delta');
        expect(saved).not.toContain('Base layer');
        expect(saved).not.toContain('id: detail');
        expect(saved).toContain('A prose paragraph after the diagrams.');
    }).toPass({ timeout: TIMEOUT });
});

test('leaves the document untouched when the extraction is cancelled', async ({ page, request }) => {
    await page.goto('smoke/diagram-in-markdown.md');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const before = await (await request.get(fileUrl(FILE))).text();

    const dialog = await openExtractDialog(page, extractableBlocks(page).first());
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT });

    // Past the 1s autosave debounce: a cancelled extraction must never reach the file
    await page.waitForTimeout(1500);
    expect(await (await request.get(fileUrl(FILE))).text()).toBe(before);
});

test('refuses to edit a block the archdia parser does not understand', async ({ page }) => {
    // The legacy body parses to no diagram at all, so applying would replace the
    // reader's own text with an empty diagram. The dialog says so and stays inert.
    await page.goto('smoke/diagram-legacy.md');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.archdia-viewer-container').first()).toBeVisible({ timeout: TIMEOUT });

    await page.locator('.code-block-wrapper').first().hover();
    await page.locator('.code-edit-btn').first().click();

    const dialog = page.getByRole('dialog', { name: 'Edit diagram' });
    await expect(dialog).toContainText('not in the archdia block format', { timeout: TIMEOUT });
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
});
