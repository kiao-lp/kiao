import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkerClientMockProvider } from 'kiao-worker';
import { ConfiguredMarkdown } from './ConfiguredMarkdown';
import type { EditableBlock } from './types';

const workerClient = { getDownloadUrl: (path: string) => `/api/files/download/${path}` };

const document = (markdown: string, props: { blockEditors?: Record<string, (block: EditableBlock) => void>; blockExtractors?: Record<string, (block: EditableBlock) => void> }) => (
    <WorkerClientMockProvider mock={{ workerClient: workerClient as any }}>
        <ConfiguredMarkdown {...props}>{markdown}</ConfiguredMarkdown>
    </WorkerClientMockProvider>
);

/**
 * The edit affordance is only as safe as the source range it reports: a wrong
 * range rewrites the wrong part of the document. These tests pin that range for
 * the fence shapes that actually occur — duplicated blocks, longer fences, and
 * fences nested in a list — by slicing the source with what the button hands us.
 */
const editedBlock = async (content: string, language: string, which = 0): Promise<EditableBlock> => {
    const onEdit = vi.fn();
    render(document(content, { blockEditors: { [language]: onEdit } }));
    const buttons = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(buttons[which]);
    expect(onEdit).toHaveBeenCalledTimes(1);
    return onEdit.mock.calls[0][0];
};

describe('ConfiguredMarkdown blockEditors', () => {
    it('reports a range spanning the whole fence', async () => {
        const content = '# Title\n\n```js\nconst a = 1;\n```\n\nAfter.\n';
        const block = await editedBlock(content, 'js');

        expect(block.language).toBe('js');
        expect(block.code).toBe('const a = 1;');
        expect(content.slice(block.range.start, block.range.end)).toBe('```js\nconst a = 1;\n```');
    });

    it('distinguishes two identical blocks', async () => {
        const fence = '```js\nsame\n```';
        const content = `${fence}\n\n${fence}\n`;
        const block = await editedBlock(content, 'js', 1);

        expect(block.range.start).toBe(content.lastIndexOf(fence));
        expect(content.slice(block.range.start, block.range.end)).toBe(fence);
    });

    it('spans a four-backtick fence holding fences of its own', async () => {
        const fence = '````archdia\n---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```\n````';
        const content = `Intro\n\n${fence}\n\nOutro\n`;
        const block = await editedBlock(content, 'archdia');

        expect(content.slice(block.range.start, block.range.end)).toBe(fence);
        expect(block.code).toContain('```plantuml');
    });

    it('spans a fence nested in a list item', async () => {
        const content = '- item\n  ```js\n  nested\n  ```\n';
        const block = await editedBlock(content, 'js');

        expect(content.slice(block.range.start, block.range.end)).toBe('```js\n  nested\n  ```');
    });

    it('reports the inner fence of a kiao:diagram block', async () => {
        const fence = '```mermaid\ngraph TD;\n```';
        const content = `<!-- kiao:diagram\n${fence}\n-->\n![diagram](Doc.assets/01-mermaid.svg)\n`;
        const block = await editedBlock(content, 'mermaid');

        expect(block.code).toBe('graph TD;');
        expect(content.slice(block.range.start, block.range.end)).toBe(fence);
    });

    it('offers no button for a language without a handler', () => {
        render(document('```js\nx\n```\n', { blockEditors: { archdia: vi.fn() } }));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('offers no button when the host passes no handlers', () => {
        render(document('```js\nx\n```\n', {}));
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });
});

describe('ConfiguredMarkdown blockExtractors', () => {
    it('reports the same block the edit button would', async () => {
        const content = '# Title\n\n```js\nconst a = 1;\n```\n\nAfter.\n';
        const onExtract = vi.fn();
        render(document(content, { blockExtractors: { js: onExtract } }));

        await userEvent.click(screen.getByRole('button', { name: 'Extract' }));

        const block: EditableBlock = onExtract.mock.calls[0][0];
        expect(block.language).toBe('js');
        expect(content.slice(block.range.start, block.range.end)).toBe('```js\nconst a = 1;\n```');
    });

    it('sits next to the edit button rather than replacing it', () => {
        render(document('```js\nx\n```\n', {
            blockEditors: { js: vi.fn() },
            blockExtractors: { js: vi.fn() },
        }));

        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Extract' })).toBeInTheDocument();
    });

    it('offers no extract button for a language without a handler', () => {
        render(document('```js\nx\n```\n', {
            blockEditors: { js: vi.fn() },
            blockExtractors: { archdia: vi.fn() },
        }));
        expect(screen.queryByRole('button', { name: 'Extract' })).toBeNull();
    });
});
