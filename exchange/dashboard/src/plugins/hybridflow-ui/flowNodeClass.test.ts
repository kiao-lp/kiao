import { describe, expect, it } from 'vitest';
import {
    instantiationChainOf, latestPublished, newClassVersion, newFlowNodeClass, readClassRef,
    readFlowNodeClasses, workflowMembersOf, writeFlowNodeClass,
} from './flowNodeClass';

describe('flowNodeClass', () => {
    it('reads a class out of a document', () => {
        const [one] = readFlowNodeClasses([{
            id: 'c1', title: 'Review', type: 'ai', tags: ['Bug'],
            onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'continue', compact: true },
            permission: 'manualLive', runner: 'r1', note: 'When the diff is ready.',
            versions: [
                { id: 'v1', number: 1, body: 'Read it.', criteria: [{ id: 'k1', text: 'Done' }], agent: 'a1', status: 'published' },
                { id: 'v2', number: 2, body: 'Draft words.', status: 'draft' },
            ],
        }]);
        expect(one.title).toBe('Review');
        expect(one.type).toBe('ai');
        expect(one.tags).toEqual(['Bug']);
        expect(one.onSuccess).toEqual({ flowNode: 'c2', flowNodes: [], mode: 'continue', compact: true });
        expect(one.permission).toBe('manualLive');
        expect(one.runner).toBe('r1');
        expect(one.note).toBe('When the diff is ready.');
        expect(one.versions).toHaveLength(2);
        expect(one.versions[0]).toMatchObject({ number: 1, status: 'published', agent: 'a1' });
        expect(one.versions[1]).toMatchObject({ number: 2, status: 'draft', criteria: [], agent: '' });
    });

    it('reads a class saying nothing as an empty Human class', () => {
        const [one] = readFlowNodeClasses([{ id: 'c1' }]);
        expect(one).toMatchObject({
            title: '', type: 'human', tags: [], at: '', spot: null,
            permission: '', runner: '', note: '', versions: [],
        });
        expect(one.onSuccess).toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
    });

    it('reads a class saying nothing as not instantiable', () => {
        expect(newFlowNodeClass('ai').instantiable).toBe(false);
        const [one] = readFlowNodeClasses([{ id: 'c1' }]);
        expect(one.instantiable).toBe(false);
        const [ticked] = readFlowNodeClasses([{ id: 'c2', instantiable: true }]);
        expect(ticked.instantiable).toBe(true);
    });

    it('writes the instantiable tick, leaving it out where the class is not offered', () => {
        const one = newFlowNodeClass('human');
        one.id = 'c1';
        one.instantiable = true;
        expect(writeFlowNodeClass(one)).toMatchObject({ id: 'c1', instantiable: true });
        const bare = newFlowNodeClass('human');
        bare.id = 'c2';
        expect(writeFlowNodeClass(bare)).not.toHaveProperty('instantiable');
    });

    it('drops the AI answers off a class that is not AI', () => {
        const [one] = readFlowNodeClasses([{
            id: 'c1', type: 'human', permission: 'manualLive', runner: 'r1',
            onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'continue', compact: true },
            versions: [{ id: 'v1', number: 1, agent: 'a1' }],
        }]);
        expect(one.permission).toBe('');
        expect(one.runner).toBe('');
        expect(one.onSuccess).toEqual({ flowNode: 'c2', flowNodes: [], mode: 'end', compact: false });
        expect(one.versions[0].agent).toBe('');
    });

    it('reads the latest published version, or null where none is published', () => {
        const one = newFlowNodeClass('ai');
        expect(latestPublished(one)).toBeNull();
        one.versions = [
            { id: 'v1', number: 1, body: '', criteria: [], template: false, agent: '', status: 'published' },
            { id: 'v2', number: 2, body: '', criteria: [], template: false, agent: '', status: 'draft' },
        ];
        expect(latestPublished(one)?.id).toBe('v1');
    });

    it('numbers a new version one more than the succession holds', () => {
        const one = newFlowNodeClass('ai');
        expect(newClassVersion(one.versions).number).toBe(1);
        one.versions = [{ id: 'v1', number: 1, body: '', criteria: [], template: false, agent: '', status: 'published' }];
        expect(newClassVersion(one.versions).number).toBe(2);
    });

    it('reads what a flow node says about its class version, or null for none', () => {
        expect(readClassRef(undefined)).toBeNull();
        expect(readClassRef({})).toBeNull();
        expect(readClassRef({
            classId: 'c1', classTitle: 'Review', versionId: 'v1', versionNumber: 2,
        })).toEqual({ classId: 'c1', classTitle: 'Review', versionId: 'v1', versionNumber: 2 });
    });

    it('writes a class saying nothing as its id and title alone', () => {
        const one = newFlowNodeClass('human');
        one.id = 'c1';
        expect(writeFlowNodeClass(one)).toEqual({ id: 'c1', title: '', versions: [] });
    });

    it('reads a version saying nothing as a description, not a template', () => {
        const [one] = readFlowNodeClasses([{
            id: 'c1', versions: [{ id: 'v1', number: 1, body: 'Read it.' }],
        }]);
        expect(one.versions[0].template).toBe(false);
    });

    it('round-trips a version in template mode', () => {
        const [one] = readFlowNodeClasses([{
            id: 'c1',
            versions: [{ id: 'v1', number: 1, body: 'Read ${what:text}.', template: true }],
        }]);
        expect(one.versions[0].template).toBe(true);
        expect(writeFlowNodeClass(one)).toMatchObject({
            versions: [{ id: 'v1', number: 1, body: 'Read ${what:text}.', template: true }],
        });
    });

    it('writes the note and the default agent, leaving both out where they say nothing', () => {
        const one = newFlowNodeClass('ai');
        one.id = 'c1';
        one.note = 'When the diff is ready.';
        one.versions = [{ ...newClassVersion([], 'Read it.'), agent: 'a1' }];
        expect(writeFlowNodeClass(one)).toMatchObject({
            note: 'When the diff is ready.',
            versions: [{ body: 'Read it.', agent: 'a1' }],
        });
        const bare = newFlowNodeClass('ai');
        bare.id = 'c2';
        bare.versions = [newClassVersion([], 'Read it.')];
        const written = writeFlowNodeClass(bare) as { note?: string; versions: { agent?: string }[] };
        expect(written.note).toBeUndefined();
        expect(written.versions[0].agent).toBeUndefined();
    });

    it('leaves the template mode out where the version is a description', () => {
        const one = newFlowNodeClass('human');
        one.id = 'c1';
        one.versions = [newClassVersion([], 'Read it.')];
        expect(writeFlowNodeClass(one)).toMatchObject({
            versions: [{ body: 'Read it.' }],
        });
        expect(writeFlowNodeClass(one)).not.toMatchObject({
            versions: [{ template: true }],
        });
    });

    it('walks the chain an instantiation makes flow nodes from', () => {
        const [first, second, third] = readFlowNodeClasses([
            { id: 'c1', onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'end' } },
            { id: 'c2', onSuccess: { flowNode: 'c3', flowNodes: [], mode: 'end' } },
            { id: 'c3' },
        ]);
        expect(instantiationChainOf([first, second, third], 'c1').map(one => one.id))
            .toEqual(['c1', 'c2', 'c3']);
        // From the middle: what came before is not instantiated.
        expect(instantiationChainOf([first, second, third], 'c2').map(one => one.id))
            .toEqual(['c2', 'c3']);
    });

    it('lists the members of a workflow class, in the order given', () => {
        const classes = readFlowNodeClasses([
            { id: 'c1', workflowClass: 'w1' },
            { id: 'c2' },
            { id: 'c3', workflowClass: 'w1' },
        ]);
        expect(workflowMembersOf(classes, 'w1').map(one => one.id)).toEqual(['c1', 'c3']);
        expect(workflowMembersOf(classes, 'gone')).toEqual([]);
    });

    it('ends the chain at a class that has gone, a circle, or nothing', () => {
        const [first, second] = readFlowNodeClasses([
            { id: 'c1', onSuccess: { flowNode: 'gone', flowNodes: [], mode: 'end' } },
            { id: 'c2', onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'end' } },
        ]);
        expect(instantiationChainOf([first, second], 'c1').map(one => one.id)).toEqual(['c1']);
        expect(instantiationChainOf([first, second], 'c2').map(one => one.id)).toEqual(['c2']);
        expect(instantiationChainOf([first, second], 'nowhere')).toEqual([]);
    });
});
