import { test, expect } from '../../harness';

// Constants for selectors and texts
const SELECTORS = {
    STATUS_BAR: '.cms-top-banner',
    COPY_BUTTON: 'button:has-text("Copy")',
};

test('template instantiation: configure values and copy to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Navigate to the Prompt template
    await page.goto('templates/Prompt.temp.md');

    // Wait for the app to load - status bar is a good indicator
    await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: 15000 });

    // Wait for the Template title to show up, confirming the main view is loaded
    await expect(page.getByRole('heading', { name: 'Prompt' })).toBeVisible({ timeout: 10000 });

    // Ensure the values column is visible by checking for the top-level template sections.
    // "title" is a sub-template id that should be visible as a section header.
    const titleHeader = page.locator('span:text-is("title")');
    await expect(titleHeader).toBeVisible({ timeout: 10000 });

    // Helper to toggle section
    const toggleSection = async (startNodeText: string, enable: boolean) => {
        // Find the text node, then find the checkbox associated with it.
        // Strategy: find the span with text, then go to parent (or sibling) to find checkbox.
        const textLocator = page.locator(`span:text-is("${startNodeText}")`);
        // Check if visible
        if (await textLocator.count() === 0) return;

        // The checkbox should be a sibling or close relative.
        // TemplateInstantiation.tsx draws an optional section as an antd Checkbox:
        // <label class="ant-checkbox-wrapper">
        //    <span class="ant-checkbox"><input type="checkbox" ... /></span>
        //    <span>{node.key}</span>
        // </label>
        const container = textLocator.locator('xpath=..');
        const checkbox = container.locator('input[type="checkbox"]');

        if (await checkbox.isVisible()) {
            const isChecked = await checkbox.isChecked();
            if (isChecked !== enable) {
                await checkbox.click();
            }
        }
    };

    // Helper to set value
    // ValueField.tsx:
    // <div>
    //    <div><span>key</span>...</div>   <-- Label container
    //    {renderInput()}                  <-- Input container (sibling of label container)
    // </div>
    const fillValue = async (key: string, value: string, type: 'text' | 'select' | 'autocomplete' = 'text') => {
        // Find the label span. It contains the key.
        // It's inside a span with background color.
        const labelSpan = page.locator(`span:has-text("${key}")`);

        // Navigate to the parent div of the label line
        const labelLineDiv = labelSpan.locator('xpath=../..');
        // The input is in the same container (ValueField div root).
        // Wait, ValueField return:
        // <div style={{ mb: '10px' }}>
        //    <div ...><span>{key}...</span></div>
        //    {renderInput()}
        // </div>
        // So labelLineDiv is the first child. The root is labelLineDiv's parent.
        const rootDiv = labelLineDiv;

        if (type === 'select') {
            await rootDiv.locator('.ant-select').click();
            await page.locator(`.ant-select-item-option-content:has-text("${value}")`).click();
        } else if (type === 'autocomplete') {
            const input = rootDiv.locator('input');
            await input.fill(value);
            try {
                // Wait for dropdown
                const dropdown = page.locator('.ant-select-dropdown:visible');
                const option = dropdown.locator(`.ant-select-item-option-content:has-text("${value}")`).first();
                if (await option.isVisible({ timeout: 5000 })) {
                    await option.click();
                } else {
                    await input.press('Enter');
                }
            } catch (e) {
                // Ignore
            }
        } else {
            await rootDiv.locator('textarea, input').fill(value);
        }
    };

    // --- Configuration Steps ---

    // root sections
    // Note: "title" is a subTemplate id.
    await toggleSection('title', true);
    await toggleSection('instructions', true);

    // commitType: feat
    await fillValue('commitType', 'feat', 'select');

    // scope:KiaoComponent: dashboard
    await fillValue('scope:KiaoComponent', 'dashboard', 'autocomplete');

    // message:text: test
    await fillValue('message:text', 'test', 'text');

    // main:text: message
    await fillValue('main:text', 'message', 'text');

    // Sub-sections in instructions
    await toggleSection('hotReloading', false);
    await toggleSection('migrationScript', false);
    await toggleSection('testInstructions', true);
    // Nested in testInstructions
    await toggleSection('compilationTests', true);
    await toggleSection('e2eTests', false);

    await toggleSection('commit', false);


    // 3. Click Copy
    await page.locator(SELECTORS.COPY_BUTTON).click();

    // 4. Verify Clipboard
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

    const expectedText = `## feat(dashboard): test

In pub/exchange/dashboard, message


Tests from your part should include (among others you might consider useful):

- ensure that all involved projects compile.`;

    expect(clipboardText.trim()).toBe(expectedText.trim());
});
