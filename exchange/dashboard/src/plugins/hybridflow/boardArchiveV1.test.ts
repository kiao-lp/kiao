import { describe, expect, it } from 'vitest';
import { readBoardArchive } from './boardArchive';

describe('version 1 board archives', () => {
    it('restores the most recent definitions as ordinary nodes and workflows', () => {
        const archive = readBoardArchive(JSON.stringify({
            kind: 'kiao-board', version: 1, name: 'Library',
            flowNodes: [{ id: 'review', title: 'Existing task', body: 'Filled', classVersion: 'v1' }],
            workflows: [{ id: 'sprint', name: 'Active work' }],
            flowNodeClasses: [
                {
                    id: 'review', title: 'Review', type: 'ai', workflowClass: 'sprint',
                    spot: { x: 30, y: 50 }, size: { w: 240, h: 170 }, tags: ['review'],
                    permission: 'default', runner: 'desktop', selection: { agent: 'scribe', harness: 'codex' },
                    note: 'Usage notes.',
                    onSuccess: { flowNode: 'approve', mode: 'end', compact: true },
                    versions: [
                        { id: 'v1', body: 'Old wording', published: true },
                        { id: 'v2', body: 'Review ${item:text}', template: true, criteria: [{ id: 'check', text: 'Done' }] },
                    ],
                },
                { id: 'wait', title: 'Wait', type: 'scheduler', duration: '30s', onSuccess: { flowNode: 'approve' } },
                { id: 'approve', title: 'Approve', type: 'human', workflowClass: 'sprint', versions: [] },
            ],
            workflowClasses: [{ id: 'sprint', name: 'Sprint' }],
        }));
        expect(archive).not.toBeNull();
        const { flowNodes, workflows } = archive!;
        const workflow = workflows.find(group => group.name === 'Sprint')!;
        expect(workflow.id).not.toBe('sprint');
        const [existing, review, wait, approve, note, join] = flowNodes;
        expect(existing).toMatchObject({ id: 'review', body: 'Filled' });
        expect(existing).not.toHaveProperty('classVersion');
        expect(review.id).not.toBe('review');
        expect(review).toMatchObject({
            type: 'ai', status: 'draft', body: 'Review ${item:text}', multiPartTemplate: true,
            criteria: [{ id: 'check', text: 'Done' }], tags: ['review'], workflow: workflow.id,
            spot: { x: 30, y: 50 }, size: { w: 240, h: 170 },
            settings: { agent: 'scribe', harness: 'codex', permission: 'default', runner: 'desktop' },
            onSuccess: { flowNode: join.id, mode: 'end', compact: true },
        });
        expect(wait).toMatchObject({ type: 'scheduler', duration: '30s', onSuccess: { flowNode: join.id } });
        expect(approve).toMatchObject({ id: 'approve', type: 'human', workflow: workflow.id });
        expect(note).toMatchObject({ type: 'note', note: 'Usage notes.', workflow: workflow.id });
        expect(join).toMatchObject({
            type: 'exclusive-gateway', workflow: workflow.id, onSuccess: { flowNodes: ['approve'] },
            routes: [{ condition: 'true', flowNode: 'approve' }],
        });
    });
});
