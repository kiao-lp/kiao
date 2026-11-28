import { describe, it, expect } from 'vitest';
import {
    BYPASS_PERMISSION, chains, FLOW_NODE_TYPE_LABELS, FLOW_NODE_TYPE_ORDER,
    hasFolder, hasTransition, isForAgent, isTask,
    newFlowNodeSettings, NO_AGENT, readType, runsItself, saysType, settingsHarness, typeChanges,
} from './flowNodeType';

/** A node is typed, and the type is a field: two of the four answers have nothing on the node to be. */
describe('the type a document says', () => {
    it('reads known types regardless of case', () => {
        expect(readType('ai', {})).toBe('ai');
        expect(readType('human', { agent: 'agent-1' })).toBe('human');
        expect(readType(' Shutdown ', {})).toBe('shutdown');
        expect(readType('scheduler', {})).toBe('scheduler');
        expect(readType(' Exclusive-Gateway ', {})).toBe('exclusive-gateway');
    });

    it('falls back on the settings where the document says no type', () => {
        expect(readType(undefined, { agent: 'agent-1' })).toBe('ai');
        expect(readType(undefined, {})).toBe('human');
        expect(readType(undefined, { effort: 'high', permission: 'manual', folder: '/' })).toBe('human');
    });

    it('reads a legacy node as AI', () => {
        expect(readType(undefined, { agent: 'claude', model: 'opus' })).toBe('ai');
        expect(readType(undefined, { model: 'opus' })).toBe('ai');
    });

    it('reads a word it has no meaning for as no answer at all', () => {
        expect(readType('robot', { agent: 'agent-1' })).toBe('ai');
        expect(readType(42, {})).toBe('human');
    });

    it('is written down for every type but the silent one', () => {
        expect(saysType('human')).toBe(false);
        expect([saysType('ai'), saysType('shutdown'), saysType('scheduler')])
            .toEqual([true, true, true]);
    });
});

describe('what each type is asked', () => {
    it('asks about a conversation on an AI node and on no other', () => {
        expect([isForAgent('ai'), hasTransition('ai')]).toEqual([true, true]);
        expect([isForAgent('human'), isForAgent('shutdown'), isForAgent('scheduler'), isForAgent('gateway')])
            .toEqual([false, false, false, false]);
        expect([hasTransition('human'), hasTransition('shutdown'), hasTransition('scheduler'), hasTransition('gateway')])
            .toEqual([false, false, false, false]);
    });

    it('asks every node but a Shutdown what comes after it', () => {
        expect(chains('shutdown')).toBe(false);
        expect([chains('ai'), chains('human'), chains('scheduler'), chains('gateway')]).toEqual([true, true, true, true]);
    });

    it('asks the two types that name work for a folder, and asks them alone', () => {
        expect([hasFolder('ai'), hasFolder('human')]).toEqual([true, true]);
        expect([hasFolder('shutdown'), hasFolder('scheduler'), hasFolder('gateway')]).toEqual([false, false, false]);
        expect([isTask('ai'), isTask('human')]).toEqual([true, true]);
        expect([isTask('shutdown'), isTask('scheduler'), isTask('gateway')]).toEqual([false, false, false]);
    });

    it('runs control nodes without an agent', () => {
        expect([runsItself('shutdown'), runsItself('scheduler'), runsItself('gateway'), runsItself('exclusive-gateway')])
            .toEqual([true, true, true, true]);
        expect([runsItself('ai'), runsItself('human')]).toEqual([false, false]);
    });
});

describe('typing a node', () => {
    it('leaves a new AI awaiting its agent selection', () => {
        expect(typeChanges({}, 'ai')).toEqual({ agent: NO_AGENT });
    });

    it('gives it no agent where the store has filed none', () => {
        expect(typeChanges({}, 'ai')).toEqual({ agent: NO_AGENT });
    });

    it('keeps the agent a node typed AI already had', () => {
        expect(typeChanges({ agent: 'agent-9' }, 'ai'))
            .toEqual({ agent: 'agent-9' });
    });

    // The three that only speak about a played turn go; the folder stays, being asked of both the types that name work.
    it('takes back what only a played turn means when a node is typed Human', () => {
        expect(typeChanges(
            { agent: 'agent-1', effort: 'high', permission: 'manual', folder: 'x' }, 'human',
        )).toEqual({ agent: undefined, model: undefined, effort: undefined, permission: undefined });
    });

    it('takes the folder back too from the two the board plays to itself', () => {
        const held = { agent: 'agent-1', effort: 'high', permission: 'manual', folder: 'x' };
        const bare = {
            agent: undefined, model: undefined, effort: undefined, permission: undefined, folder: undefined,
        };
        expect(typeChanges(held, 'shutdown')).toEqual(bare);
        expect(typeChanges(held, 'scheduler')).toEqual(bare);
    });
});

/** A node made on the board is not a node read out of a document: the file means Human by its silence. */
describe('the node the board makes', () => {
    it('starts with explicitly selected execution settings', () => {
        expect(newFlowNodeSettings())
            .toEqual({});
    });

    it('leaves the mode unsaid where the harness offers no bypass', () => {
        expect(newFlowNodeSettings())
            .toEqual({});
    });

    it('gives it no effort and no folder, so nothing plays it unasked', () => {
        const settings = newFlowNodeSettings();
        expect(settings.effort).toBeUndefined();
        expect(settings.folder).toBeUndefined();
    });
});

describe('the harness a node is read against', () => {
    const agents = [
        { id: 'agent-1', harness: 'claude' },
        { id: 'agent-2', harness: 'codex' },
    ];

    it('is its agent\u2019s', () => {
        expect(settingsHarness({ agent: 'agent-2' }, agents)).toBe('codex');
    });

    it('is the value itself where it names no agent of the list', () => {
        expect(settingsHarness({ agent: 'claude', model: 'opus' }, agents)).toBe('claude');
    });

    it('is empty for a node that names nothing', () => {
        expect(settingsHarness({}, agents)).toBe('');
    });
});

describe('the kinds on offer', () => {
    it('reads an agent harness from its publication while a different harness is drafted', () => {
        expect(settingsHarness({ agent: 'reviewer' }, [{ id: 'reviewer', harness: 'codex',
            published: { harness: 'claude' } }])).toBe('claude');
    });
    it('offers node types in menu order', () => {
        expect(FLOW_NODE_TYPE_ORDER).toEqual([
            'ai', 'human', 'start', 'shutdown', 'scheduler', 'bitbucket-pr-status', 'bitbucket-commit-status',
            'gateway', 'exclusive-gateway', 'limiter', 'note', 'value', 'role',
        ]);
        expect(FLOW_NODE_TYPE_LABELS.gateway).toBe('Parallel gateway');
        expect(FLOW_NODE_TYPE_LABELS['exclusive-gateway']).toBe('Exclusive gateway');
    });
});
