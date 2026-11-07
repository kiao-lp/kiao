import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerClient } from 'kiao-worker';
import { parseTempMd } from '@cms-kit/template-lang';
import {
    AI_TEMPLATE_PATH, ensureDefaultFlowNodeTemplates, HUMAN_TEMPLATE_PATH, listFlowNodeTemplates,
    FLOW_NODE_TEMPLATES_PATH, templateForType, templateName, versionBodyTemplate,
} from './flowNodeTemplates';

/** The folder a flow node's description is written from. */

const client = {
    listFiles: vi.fn(),
    createFolder: vi.fn(),
    update: vi.fn(),
};

const asClient = () => client as unknown as WorkerClient;

const file = (path: string, isDirectory = false) => ({ path, isDirectory });

beforeEach(() => {
    vi.clearAllMocks();
    client.listFiles.mockResolvedValue([]);
    client.createFolder.mockResolvedValue(undefined);
    client.update.mockResolvedValue(undefined);
});

describe('the flow node templates on offer', () => {
    it('is the folder’s `.temp.md` files, by the name it shows them under', async () => {
        client.listFiles.mockResolvedValue([
            file(`${FLOW_NODE_TEMPLATES_PATH}/Refactoring.temp.md`),
            file(`${FLOW_NODE_TEMPLATES_PATH}/Bug report.temp.md`),
            file(`${FLOW_NODE_TEMPLATES_PATH}/notes.md`),
            file(`${FLOW_NODE_TEMPLATES_PATH}/drafts`, true),
        ]);

        const found = await listFlowNodeTemplates(asClient());

        expect(client.listFiles).toHaveBeenCalledWith(FLOW_NODE_TEMPLATES_PATH);
        expect(found.map(templateName)).toEqual(['Bug report', 'Refactoring']);
    });

    it('is nothing at all where the folder is not there', async () => {
        client.listFiles.mockRejectedValue(new Error('404'));

        expect(await listFlowNodeTemplates(asClient())).toEqual([]);
    });
});

describe('the two templates a card’s type names', () => {
    it('is AI for a card Claude plays and Human for one somebody does', () => {
        expect(templateForType('ai')).toBe(AI_TEMPLATE_PATH);
        expect(templateForType('human')).toBe(HUMAN_TEMPLATE_PATH);
        expect(templateForType('shutdown')).toBeNull();
        expect(templateForType('scheduler')).toBeNull();
    });

    it('writes them both on a store that has neither, around the description', async () => {
        const found = await ensureDefaultFlowNodeTemplates(asClient());

        expect(client.createFolder).toHaveBeenCalledWith(FLOW_NODE_TEMPLATES_PATH);
        expect(found).toEqual([AI_TEMPLATE_PATH, HUMAN_TEMPLATE_PATH]);

        const written = Object.fromEntries(client.update.mock.calls);
        expect(written[AI_TEMPLATE_PATH]).toContain('${flowNodeDescription}');
        expect(written[AI_TEMPLATE_PATH]).toContain('commit your changes, but do not push');
        expect(written[HUMAN_TEMPLATE_PATH]).toContain('```text\n${flowNodeDescription}\n```');
        expect(written[HUMAN_TEMPLATE_PATH]).not.toContain('do not push');
    });

    it('writes AI’s standing instructions as clauses that can be switched off', async () => {
        await ensureDefaultFlowNodeTemplates(asClient());

        const written = Object.fromEntries(client.update.mock.calls);
        const ai = parseTempMd(written[AI_TEMPLATE_PATH]);

        expect(ai.subTemplates.map(sub => sub.id)).toEqual(['noCode', 'colleague', 'commit']);
        expect(ai.subTemplates.map(sub => sub.defaultText)).toEqual(['', '', '']);
        expect(ai.rootTemplate.textTemplate)
            .toBe('${noCode}\n${colleague}\n${flowNodeDescription}\n${commit}');
        expect(parseTempMd(written[HUMAN_TEMPLATE_PATH]).subTemplates).toEqual([]);
    });

    it('leaves the one the store already has, and writes only the other', async () => {
        client.listFiles.mockResolvedValue([file(AI_TEMPLATE_PATH), file(`${FLOW_NODE_TEMPLATES_PATH}/Bug report.temp.md`)]);

        const found = await ensureDefaultFlowNodeTemplates(asClient());

        expect(client.update).toHaveBeenCalledTimes(1);
        expect(client.update.mock.calls[0][0]).toBe(HUMAN_TEMPLATE_PATH);
        expect(found.map(templateName)).toEqual(['AI', 'Bug report', 'Human']);
    });

    it('writes nothing where both are there', async () => {
        client.listFiles.mockResolvedValue([file(AI_TEMPLATE_PATH), file(HUMAN_TEMPLATE_PATH)]);

        expect(await ensureDefaultFlowNodeTemplates(asClient())).toEqual([AI_TEMPLATE_PATH, HUMAN_TEMPLATE_PATH]);
        expect(client.createFolder).not.toHaveBeenCalled();
        expect(client.update).not.toHaveBeenCalled();
    });

    // A store that cannot be written to still offers what it really holds: the select is drawn on what came.
    it('offers what listing found when the store refuses the write', async () => {
        client.listFiles.mockResolvedValue([file(`${FLOW_NODE_TEMPLATES_PATH}/Bug report.temp.md`)]);
        client.update.mockRejectedValue(new Error('read-only'));

        const found = await ensureDefaultFlowNodeTemplates(asClient());

        expect(found.map(templateName)).toEqual(['Bug report']);
    });
});

describe('a class version body as a template', () => {
    /** Markdown, a line at a time — a template literal cannot hold the fences a .temp.md is made of. */
    const md = (...lines: string[]): string => lines.join('\n');

    it('is a complete .temp.md template, optional blocks included', () => {
        const template = versionBodyTemplate(md(
            '# Review',
            '',
            '## Root',
            '',
            '### textTemplate',
            '',
            '```text',
            'Read ${what:text}.${context}',
            '```',
            '',
            '## Context',
            '',
            '### defaultText',
            '',
            '```text',
            '',
            '```',
            '',
            '### textTemplate',
            '',
            '```text',
            ' Context: ${detail:text}.',
            '```',
        ), 'Review');

        expect(template.name).toBe('Review');
        expect(template.rootTemplate.textTemplate).toBe('Read ${what:text}.${context}');
        expect(template.subTemplates).toEqual([
            { id: 'context', textTemplate: ' Context: ${detail:text}.', defaultText: '' },
        ]);
    });

    it('reads plain words as the Root alone, rather than dropping them', () => {
        const template = versionBodyTemplate('Read ${what:text}.', 'Review');

        expect(template.name).toBe('Review');
        expect(template.rootTemplate.textTemplate).toBe('Read ${what:text}.');
        expect(template.subTemplates).toEqual([]);
    });
});
