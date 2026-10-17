import { describe, it, expect } from 'vitest';
import {
    BYPASS_PERMISSION, chains, FLOW_NODE_CLASS_TYPE_ORDER, FLOW_NODE_TYPE_LABELS, FLOW_NODE_TYPE_ORDER,
    hasFolder, hasTransition, isForAgent, isTask,
    newFlowNodeSettings, NO_AGENT, readType, runsItself, saysType, settingsPlatform, typeChanges,
} from './flowNodeType';

/**
 * A card is **typed**, and the type is a field: two of the four answers have nothing on the card to
 * be read off, a Shutdown having no options at all. What the field does not say, the settings still
 * do — which is how every board written before it is read.
 */
describe('the type a document says', () => {
    it('reads the four words it knows, however they are cased', () => {
        expect(readType('ai', {})).toBe('ai');
        expect(readType('human', { agent: 'agent-1' })).toBe('human');
        expect(readType(' Shutdown ', {})).toBe('shutdown');
        expect(readType('scheduler', {})).toBe('scheduler');
    });

    // Every board written before the field, and every one written by hand: a named agent is AI.
    it('falls back on the settings where the document says no type', () => {
        expect(readType(undefined, { agent: 'agent-1' })).toBe('ai');
        expect(readType(undefined, {})).toBe('human');
        // The other three say nothing about it: they are how a turn runs, not whether there is one.
        expect(readType(undefined, { effort: 'high', permission: 'manual', folder: '/' })).toBe('human');
    });

    // A board written before managed agents: the engine, with the model beside it.
    it('reads a legacy card as AI', () => {
        expect(readType(undefined, { agent: 'claude', model: 'opus' })).toBe('ai');
        expect(readType(undefined, { model: 'opus' })).toBe('ai');
    });

    it('reads a word it has no meaning for as no answer at all', () => {
        expect(readType('robot', { agent: 'agent-1' })).toBe('ai');
        expect(readType(42, {})).toBe('human');
    });

    // Human is what a card says by saying nothing, so it is the one type absent from the file.
    it('is written down for every type but the silent one', () => {
        expect(saysType('human')).toBe(false);
        expect([saysType('ai'), saysType('shutdown'), saysType('scheduler')])
            .toEqual([true, true, true]);
    });
});

describe('what each type is asked', () => {
    it('asks about a conversation on an AI card and on no other', () => {
        expect([isForAgent('ai'), hasTransition('ai')]).toEqual([true, true]);
        expect([isForAgent('human'), isForAgent('shutdown'), isForAgent('scheduler'), isForAgent('gateway')])
            .toEqual([false, false, false, false]);
        expect([hasTransition('human'), hasTransition('shutdown'), hasTransition('scheduler'), hasTransition('gateway')])
            .toEqual([false, false, false, false]);
    });

    // Nothing is ever played once the machine is off, so that one card names nothing after it. A
    // Gateway chains too — its branches, the list way.
    it('asks every card but a Shutdown what comes after it', () => {
        expect(chains('shutdown')).toBe(false);
        expect([chains('ai'), chains('human'), chains('scheduler'), chains('gateway')]).toEqual([true, true, true, true]);
    });

    // Where the work is is worth writing down whoever does it; the three the board plays to itself
    // run nothing and run it nowhere.
    it('asks the two types that name work for a folder, and asks them alone', () => {
        expect([hasFolder('ai'), hasFolder('human')]).toEqual([true, true]);
        expect([hasFolder('shutdown'), hasFolder('scheduler'), hasFolder('gateway')]).toEqual([false, false, false]);
        // The folder is asked of a task and of nothing else: the two questions have the same
        // answer today, and are two questions.
        expect([isTask('ai'), isTask('human')]).toEqual([true, true]);
        expect([isTask('shutdown'), isTask('scheduler'), isTask('gateway')]).toEqual([false, false, false]);
    });

    it('knows which three the board plays to itself', () => {
        expect([runsItself('shutdown'), runsItself('scheduler'), runsItself('gateway')]).toEqual([true, true, true]);
        expect([runsItself('ai'), runsItself('human')]).toEqual([false, false]);
    });
});

describe('typing a card', () => {
    // A select opening on a blank is a card that looks broken the moment it is typed AI, so the
    // store's first agent goes on it straight away.
    it('gives a card typed AI an agent to be played on', () => {
        expect(typeChanges({}, 'ai', { agent: 'agent-1' })).toEqual({ agent: 'agent-1' });
    });

    // Where the store has filed none yet there is nothing to give it: no agent is the truth about
    // it, the card wearing the incomplete mark rather than an engine the service would refuse.
    it('gives it no agent where the store has filed none', () => {
        expect(typeChanges({}, 'ai')).toEqual({ agent: NO_AGENT });
    });

    // Switching back and forth is not a card being quietly moved to another agent.
    it('keeps the agent a card typed AI already had', () => {
        expect(typeChanges({ agent: 'agent-9' }, 'ai', { agent: 'agent-1' }))
            .toEqual({ agent: 'agent-9' });
    });

    // The three that only speak about a played turn go; the folder stays, being asked of both the
    // types that name work. The legacy model goes with them: retyping a card is the moment a board
    // written before managed agents stops saying it.
    it('takes back what only a played turn means when a card is typed Human', () => {
        expect(typeChanges(
            { agent: 'agent-1', effort: 'high', permission: 'manual', folder: 'x' }, 'human',
        )).toEqual({ agent: undefined, model: undefined, effort: undefined, permission: undefined });
    });

    // A Shutdown and a Scheduler are about the machine rather than about the store.
    it('takes the folder back too from the two the board plays to itself', () => {
        const held = { agent: 'agent-1', effort: 'high', permission: 'manual', folder: 'x' };
        const bare = {
            agent: undefined, model: undefined, effort: undefined, permission: undefined, folder: undefined,
        };
        expect(typeChanges(held, 'shutdown')).toEqual(bare);
        expect(typeChanges(held, 'scheduler')).toEqual(bare);
    });
});

/**
 * A card **made on the board** is not a card read out of a document: the file means Human by its
 * silence, and the canvas menu means an agent's work.
 */
describe('the card the board makes', () => {
    it('makes it AI, with the store\'s first agent and its bypass mode', () => {
        expect(newFlowNodeSettings({ agent: 'agent-1', permission: BYPASS_PERMISSION }))
            .toEqual({ agent: 'agent-1', permission: BYPASS_PERMISSION });
    });

    // Where the agent's platform publishes no such mode, the card asks for one rather than claiming
    // a mode its engine never heard of — which is also what leaves it unplayable until somebody
    // answers.
    it('leaves the mode unsaid where the platform offers no bypass', () => {
        expect(newFlowNodeSettings({ agent: 'agent-1', permission: '' }))
            .toEqual({ agent: 'agent-1' });
    });

    // Two answers are left to the user on purpose: what the turn costs, and where it writes.
    it('gives it no effort and no folder, so nothing plays it unasked', () => {
        const settings = newFlowNodeSettings({ agent: 'agent-1', permission: BYPASS_PERMISSION });
        expect(settings.effort).toBeUndefined();
        expect(settings.folder).toBeUndefined();
    });
});

describe('the platform a card is read against', () => {
    const agents = [
        { id: 'agent-1', platform: 'claude' },
        { id: 'agent-2', platform: 'codex' },
    ];

    it('is its agent\u2019s', () => {
        expect(settingsPlatform({ agent: 'agent-2' }, agents)).toBe('codex');
    });

    // A card written before managed agents names the engine directly, and its effort and permission
    // mode are still that engine's vocabulary.
    it('is the value itself where it names no agent of the list', () => {
        expect(settingsPlatform({ agent: 'claude', model: 'opus' }, agents)).toBe('claude');
    });

    it('is empty for a card that names nothing', () => {
        expect(settingsPlatform({}, agents)).toBe('');
    });
});

describe('the kinds on offer', () => {
    it('offers all five to a card, and every kind but the gateway to a class', () => {
        expect(FLOW_NODE_TYPE_ORDER).toEqual(['ai', 'human', 'shutdown', 'scheduler', 'gateway']);
        expect(FLOW_NODE_CLASS_TYPE_ORDER).toEqual(['ai', 'human', 'shutdown', 'scheduler']);
        expect(FLOW_NODE_TYPE_LABELS.gateway).toBe('Parallel gateway');
    });
});
