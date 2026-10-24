import { describe, it, expect } from 'vitest';
import type { AgentConversationMessage, AgentPermissionMode, AgentWireBackgroundTask } from 'kiao-worker';

import { applyFrame, emptyRuntime } from './chatConversationReducer';

const CONV = 'conv-a';

const start = (
    turnId: string, permissionMode: AgentPermissionMode = 'manual',
): AgentConversationMessage => ({
    type: 'start',
    conversationId: CONV,
    turnId,
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    thinking: true,
    permissionMode,
    folder: 'units/demo',
    startedAt: 1_700_000_000_000,
});

const output = (
    turnId: string, data: string, index = 0, kind: 'text' | 'thinking' = 'text',
): AgentConversationMessage => ({ type: 'output', conversationId: CONV, turnId, index, kind, data });

const toolUse = (
    turnId: string, index: number, name: string, input: string,
): AgentConversationMessage => ({ type: 'tool_use', conversationId: CONV, turnId, index, name, input });

const delegation = (
    turnId: string, index: number,
): AgentConversationMessage => ({
    type: 'subagent',
    conversationId: CONV,
    turnId,
    index,
    kind: 'subagent',
    text: 'child did things',
    subagent: {
        subagentId: 'sub-1',
        role: 'researcher',
        objective: 'find the bug',
        status: 'completed',
        result: 'it was the cache',
        blocks: [
            { kind: 'thinking', text: 'where would I hide' },
            { kind: 'tool_use', name: 'Read', input: 'x' },
            { kind: 'text', text: 'Found it.' },
        ],
    },
});

const permissionRequest = (turnId: string, requestId: string): AgentConversationMessage =>
    ({ type: 'permission_request', conversationId: CONV, turnId, requestId, toolName: 'Edit', description: 'notes.md' });

const questionRequest = (turnId: string, requestId: string): AgentConversationMessage => ({
    type: 'question_request',
    conversationId: CONV,
    turnId,
    requestId,
    toolName: 'AskUserQuestion',
    questions: [{ question: 'Tabs or spaces?', header: 'Indent', options: [{ label: 'Tabs' }, { label: 'Spaces' }] }],
});

/** Folds a run of frames onto a fresh runtime, the way the provider's listener does. */
const fold = (...frames: AgentConversationMessage[]) =>
    frames.reduce(applyFrame, emptyRuntime(CONV));

/** The turn's blocks as "<kind>:<text|summary>", short enough to write an expectation out in full. */
const shape = (state: ReturnType<typeof emptyRuntime>) =>
    state.blocks.map(block => `${block.kind}:${block.kind === 'tool_use' ? block.summary : block.text}`);

describe('applyFrame — the turn-id epoch fence', () => {
    it('drops an output frame from a turn we have already left', () => {
        const state = fold(start('t1'), output('t1', 'first'), start('t2'));

        const after = applyFrame(state, output('t1', ' straggler'));

        // Not merely ignored in effect: the very same state object comes back.
        expect(after).toBe(state);
        expect(after.blocks).toEqual([]);
    });

    it('never fences a frame that carries no turn', () => {
        const state = fold(start('t1'), output('t1', 'partial'));

        const after = applyFrame(state, { type: 'not_running', conversationId: CONV });

        expect(after.running).toBe(false);
        expect(shape(after)).toEqual(['text:partial']);
    });
});

describe('applyFrame — ordered blocks', () => {
    // The point of the whole block model: a turn that writes, thinks, calls a tool and writes again
    // is four things that happened in that order, and the panel has to be able to show it as one.
    it('keeps text, thinking and tool calls in the order they arrived', () => {
        const state = fold(
            start('t1'),
            output('t1', 'Looking.', 0),
            output('t1', 'probably units/', 1, 'thinking'),
            toolUse('t1', 2, 'Read', 'units/a.md'),
            output('t1', ' Found it.', 3),
        );

        expect(shape(state)).toEqual([
            'text:Looking.',
            'thinking:probably units/',
            'tool_use:Read(units/a.md)',
            'text: Found it.',
        ]);
    });

    it('appends a delta to the block it addresses, not to the last one', () => {
        const state = fold(
            start('t1'),
            output('t1', 'Half', 0),
            toolUse('t1', 1, 'Bash', 'ls'),
            output('t1', ' a sentence.', 0),
        );

        expect(shape(state)).toEqual(['text:Half a sentence.', 'tool_use:Bash(ls)']);
    });

    // A frame that never arrived must not shift every block after it by one: the index is the
    // model's account of where this belongs, and it is what is trusted.
    it('fills a gap rather than closing it', () => {
        const state = fold(start('t1'), output('t1', 'third', 2));

        expect(shape(state)).toEqual(['text:', 'text:', 'text:third']);
    });
});

describe('applyFrame — turn boundaries', () => {
    it('start resets the streamed turn, moves the epoch and keeps the session', () => {
        const state = fold(
            start('t1'),
            { type: 'session', conversationId: CONV, turnId: 't1', sessionId: 'sess-7' },
            output('t1', 'previous answer'),
            toolUse('t1', 1, 'Bash', 'ls'),
            permissionRequest('t1', 'req-1'),
        );

        const after = applyFrame(state, start('t2'));

        expect(after.turnId).toBe('t2');
        expect(after.running).toBe(true);
        expect(after.blocks).toEqual([]);
        expect(after.permissionRequests).toEqual([]);
        // The CLI session outlives a turn — it is what the next one resumes.
        expect(after.sessionId).toBe('sess-7');
    });

    it('sync replaces the blocks and the pending set instead of extending them', () => {
        const state = fold(start('t1'), output('t1', 'half an ans'), permissionRequest('t1', 'req-1'));

        const after = applyFrame(state, {
            type: 'sync', permissionMode: 'manual', agent: 'claude',
            conversationId: CONV,
            turnId: 't1',
            running: true,
            userText: 'do the thing',
            blocks: [
                { kind: 'text', text: 'the full recovered answer' },
                { kind: 'tool_use', name: 'Bash', input: 'ls' },
            ],
            pendingPermissions: [{ requestId: 'req-2', toolName: 'Write' }],
            startedAt: 1_700_000_000_000,
        });

        expect(shape(after)).toEqual(['text:the full recovered answer', 'tool_use:Bash(ls)']);
        expect(after.userText).toBe('do the thing');
        expect(after.permissionRequests.map(request => request.requestId)).toEqual(['req-2']);
    });
});

describe('applyFrame — permission requests', () => {
    it('shows the display name and the input the decision is about', () => {
        const state = fold(start('t1'), {
            type: 'permission_request',
            conversationId: CONV,
            turnId: 't1',
            requestId: 'req-1',
            toolName: 'Bash',
            displayName: 'Shell',
            input: '{\n  "command": "ls"\n}',
        });

        expect(state.permissionRequests).toEqual([{
            requestId: 'req-1',
            toolName: 'Shell',
            description: undefined,
            input: '{\n  "command": "ls"\n}',
        }]);
    });

    it('does not stack two cards for the same request id', () => {
        const state = fold(start('t1'), permissionRequest('t1', 'req-1'), permissionRequest('t1', 'req-1'));

        expect(state.permissionRequests).toHaveLength(1);
    });

    it('drops a request the CLI withdrew or another socket answered', () => {
        const state = fold(
            start('t1'),
            permissionRequest('t1', 'req-1'),
            { type: 'permission_resolved', conversationId: CONV, turnId: 't1', requestId: 'req-1', outcome: 'cancelled' },
        );

        expect(state.permissionRequests).toEqual([]);
    });
});

describe('applyFrame — questions', () => {
    it('holds a question apart from the permissions, which are answered by another frame', () => {
        const state = fold(start('t1'), permissionRequest('t1', 'req-1'), questionRequest('t1', 'req-q'));

        expect(state.permissionRequests.map(request => request.requestId)).toEqual(['req-1']);
        expect(state.questionRequests).toEqual([{
            requestId: 'req-q',
            toolName: 'AskUserQuestion',
            questions: [{
                question: 'Tabs or spaces?',
                header: 'Indent',
                multiSelect: undefined,
                options: [{ label: 'Tabs' }, { label: 'Spaces' }],
            }],
        }]);
    });

    it('does not stack two cards for the same request id', () => {
        const state = fold(start('t1'), questionRequest('t1', 'req-q'), questionRequest('t1', 'req-q'));

        expect(state.questionRequests).toHaveLength(1);
    });

    it('drops a question answered here, on another socket, or withdrawn', () => {
        const state = fold(
            start('t1'),
            questionRequest('t1', 'req-q'),
            { type: 'permission_resolved', conversationId: CONV, turnId: 't1', requestId: 'req-q', outcome: 'allow' },
        );

        expect(state.questionRequests).toEqual([]);
    });

    it('replays the questions a reconnecting tab has to be able to answer', () => {
        const state = fold(start('t1'), {
            type: 'sync',
            conversationId: CONV,
            turnId: 't1',
            running: true,
            userText: 'ask me something',
            blocks: [],
            permissionMode: 'bypassPermissions',
            agent: 'claude',
            pendingPermissions: [],
            pendingQuestions: [{
                requestId: 'req-q',
                toolName: 'AskUserQuestion',
                questions: [{ question: 'Which language?', options: [] }],
            }],
            startedAt: 1_700_000_000_000,
        });

        expect(state.questionRequests.map(request => request.requestId)).toEqual(['req-q']);
        // The mode a turn runs in says nothing about whether it may ask: bypass is about tool calls.
        expect(state.permissionMode).toBe('bypassPermissions');
    });
});

describe('applyFrame — what was said into the turn', () => {
    const between = (turnId: string, text: string): AgentConversationMessage =>
        ({ type: 'between', conversationId: CONV, turnId, text });

    it('keeps them in the order they were said, apart from the reply', () => {
        const state = fold(
            start('t1'),
            output('t1', 'counting'),
            between('t1', 'stop at ten'),
            toolUse('t1', 1, 'Bash', 'seq 1 10'),
            between('t1', 'and skip seven'),
        );

        expect(state.betweens).toEqual(['stop at ten', 'and skip seven']);
        // Not a block: the blocks are the turn's own account of itself, and these are the user
        // interrupting it. Folding one in would put words the model never said into its reply.
        expect(shape(state)).toEqual(['text:counting', 'tool_use:Bash(seq 1 10)']);
    });

    it('keeps two identical remarks as two remarks', () => {
        const state = fold(start('t1'), between('t1', 'hurry up'), between('t1', 'hurry up'));

        // The service emits this frame once per message it actually handed to the CLI, so a repeat
        // is a repeat — de-duplicating would swallow the second of two impatient nudges.
        expect(state.betweens).toEqual(['hurry up', 'hurry up']);
    });

    it('leaves them with the turn they were said into', () => {
        const state = fold(start('t1'), between('t1', 'stop at ten'), start('t2'));

        expect(state.betweens).toEqual([]);
    });

    it('is fenced on the turn like everything else', () => {
        const state = fold(start('t1'), start('t2'));

        expect(applyFrame(state, between('t1', 'straggler')).betweens).toEqual([]);
    });
});

describe('applyFrame — settling a turn', () => {
    it('done clears running and every card left up', () => {
        const state = fold(
            start('t1'),
            permissionRequest('t1', 'req-1'),
            questionRequest('t1', 'req-q'),
            { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 },
        );

        expect(state.running).toBe(false);
        expect(state.permissionRequests).toEqual([]);
        expect(state.questionRequests).toEqual([]);
    });

    it('error clears running and the pending set and records the code the UI branches on', () => {
        const state = fold(start('t1'), permissionRequest('t1', 'req-1'), {
            type: 'error',
            conversationId: CONV,
            code: 'bad_folder',
            message: "The conversation's folder is unusable: units/demo",
        });

        expect(state.running).toBe(false);
        expect(state.permissionRequests).toEqual([]);
        expect(state.lastError).toEqual({
            code: 'bad_folder',
            message: "The conversation's folder is unusable: units/demo",
        });
    });

    it('leaves the turn running through a cli_error the CLI streams straight past', () => {
        const state = fold(start('t1'), output('t1', 'half an ans'), permissionRequest('t1', 'req-1'), {
            type: 'error',
            conversationId: CONV,
            turnId: 't1',
            code: 'cli_error',
            message: 'a tool blew up',
        });

        // The CLI emits this one mid-stream and keeps reading: more output, and finally `done`, still
        // follow. Settling here takes the Stop button away and drops a card the CLI is still parked
        // on — and nothing times a pending request out, so the turn would hang with neither.
        expect(state.running).toBe(true);
        expect(state.permissionRequests).toHaveLength(1);
        expect(state.turnId).toBe('t1');
        expect(state.lastError?.code).toBe('cli_error');

        // And the rest of the turn still lands on it, `done` included.
        const finished = [
            output('t1', 'the rest of it'),
            { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 } as AgentConversationMessage,
        ].reduce(applyFrame, state);
        expect(shape(finished)).toEqual(['text:half an ansthe rest of it']);
        expect(finished.running).toBe(false);
    });

    it('leaves the turn running through a conversation_busy, which says one is', () => {
        const state = fold(start('t1'), output('t1', 'half an ans'), permissionRequest('t1', 'req-1'), {
            type: 'error',
            conversationId: CONV,
            code: 'conversation_busy',
            message: 'This conversation is already working on a message.',
        });

        // It is the one code that asserts a turn *is* running, it names no turn, and it reaches every
        // subscriber. Settling on it takes the Stop button away from a turn that is still working,
        // drops the epoch the rest of its frames are fenced against, and leaves the reply with
        // nowhere to be handed over to — the last exchange then renders twice, for good.
        expect(state.running).toBe(true);
        expect(state.turnId).toBe('t1');
        expect(state.permissionRequests).toHaveLength(1);
        expect(state.lastError?.code).toBe('conversation_busy');

        // And the refused turn runs on to its own end, fenced as it always was.
        const finished = [
            output('t1', 'the rest of it'),
            { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 } as AgentConversationMessage,
        ].reduce(applyFrame, state);
        expect(shape(finished)).toEqual(['text:half an ansthe rest of it']);
        expect(finished.running).toBe(false);
    });

    it('leaves a running turn alone when another user is refused an action on it', () => {
        const state = fold(start('t1'), output('t1', 'working'), {
            type: 'error',
            conversationId: CONV,
            code: 'not_permitted',
            message: 'This turn was started by another user.',
        });

        // `not_permitted` refuses somebody else's `stop`, reaches every subscriber and carries no
        // turn — so the owner, whose turn is untouched and still streaming, must not be settled by it.
        expect(state.running).toBe(true);
        expect(state.turnId).toBe('t1');
    });

    it('drops the epoch on a refusal that names no turn', () => {
        const state = fold(
            start('t1'),
            output('t1', 'the first reply'),
            { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 },
            {
                type: 'error',
                conversationId: CONV,
                code: 'bad_folder',
                message: "The conversation's folder is unusable: units/demo",
            },
        );

        // Nothing was spawned and nothing was written, so the turn id must stop pointing at the turn
        // *before* it: that is what tells the view a refused prompt has no transcript record to be
        // handed over to, and keeps it on screen next to the reason it was refused.
        expect(state.turnId).toBeNull();
    });
});

describe('applyFrame — resyncing', () => {
    const doneTurn = () => ({
        ...fold(start('t1'), output('t1', 'the whole reply'), { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 }),
        // What the view sets once the transcript holds this turn.
        settled: true,
    });

    const syncOf = (turnId: string, running: boolean, betweens?: string[]): AgentConversationMessage => ({
        type: 'sync', permissionMode: 'manual', agent: 'claude',
        conversationId: CONV,
        turnId,
        running,
        userText: 'do the thing',
        betweens,
        blocks: [{ kind: 'text', text: 'the whole reply' }],
        startedAt: 1_700_000_000_000,
    });

    it('replaces what was said into the turn rather than adding to it', () => {
        const held = fold(start('t1'), { type: 'between', conversationId: CONV, turnId: 't1', text: 'stop at ten' });

        const after = applyFrame(held, syncOf('t1', true, ['stop at ten', 'and skip seven']));

        // FULL, like the blocks: a resync repairs by replacement, and merging would show the first
        // remark twice in a tab that had already heard it.
        expect(after.betweens).toEqual(['stop at ten', 'and skip seven']);
    });

    it('empties them for a service that sends none', () => {
        const held = fold(start('t1'), { type: 'between', conversationId: CONV, turnId: 't1', text: 'stop at ten' });

        expect(applyFrame(held, syncOf('t1', true)).betweens).toEqual([]);
    });

    it('keeps a turn already handed over to the transcript handed over', () => {
        const after = applyFrame(doneTurn(), syncOf('t1', false));

        // The hub answers a subscribe with the last held turn for half an hour, so every reconnect
        // replays a turn the transcript already holds. Forgetting the hand-over renders that last
        // exchange a second time, under the first.
        expect(after.settled).toBe(true);
    });

    it('leaves a turn that arrived already finished to the transcript', () => {
        const after = applyFrame(emptyRuntime(CONV), syncOf('t1', false));

        // The hub answers a subscribe with the last held turn for half an hour, so every reload
        // within that window replays a turn this tab never watched. The service writes a turn's
        // records before it stops calling it running, so the transcript is what has to show it:
        // rendering these bubbles as well puts the last exchange on screen a second time.
        expect(after.arrivedFinished).toBe(true);
        expect(after.turnId).toBe('t1');
    });

    it('keeps it that way when a second reconnect replays the same finished turn', () => {
        const once = applyFrame(emptyRuntime(CONV), syncOf('t1', false));

        const twice = applyFrame(once, syncOf('t1', false));

        expect(twice.arrivedFinished).toBe(true);
    });

    it('takes a resync of a still-running turn as new', () => {
        const after = applyFrame(doneTurn(), syncOf('t1', true));

        expect(after.settled).toBe(false);
        expect(after.arrivedFinished).toBe(false);
    });

    it('keeps showing a turn this tab watched end while its hand-over read is still failing', () => {
        const watched = fold(start('t1'), output('t1', 'the whole reply'), { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 });

        const after = applyFrame(watched, syncOf('t1', false));

        // The reply is on the runtime and nowhere the view can reach until that read lands, so this
        // is the one finished turn whose bubbles are the only copy.
        expect(after.arrivedFinished).toBe(false);
    });

    it('drops a prompt of its own that the conversation turns out to be running on', () => {
        // The `start` that answered this prompt never reached this tab — the socket dropped between
        // the two — so the reconnect's `sync` is the first news of the turn spawned for it. The
        // service writes the user's record before it spawns, so the transcript is already showing
        // that prompt: keeping this copy as well puts the same sentence on screen twice, and it is
        // cleared by nothing else until the next prompt is sent.
        const sent = { ...emptyRuntime(CONV), userText: 'refactor this', pendingText: 'refactor this' };

        const after = applyFrame(sent, {
            type: 'sync', permissionMode: 'manual', agent: 'claude',
            conversationId: CONV,
            turnId: 't1',
            running: true,
            userText: 'refactor this',
            blocks: [{ kind: 'text', text: 'working on it' }],
            startedAt: 1_700_000_000_000,
        });

        expect(after.pendingText).toBe('');
    });

    it('keeps a prompt of its own that the running turn is not the answer to', () => {
        // The reconnect finds a turn under way that this tab's prompt had nothing to do with — the
        // `conversation_busy` case. That prompt was refused and never recorded anywhere, so this is
        // still the only copy of it.
        const sent = { ...emptyRuntime(CONV), userText: 'refactor this', pendingText: 'refactor this' };

        const after = applyFrame(sent, {
            type: 'sync', permissionMode: 'manual', agent: 'claude',
            conversationId: CONV,
            turnId: 't1',
            running: true,
            userText: 'something else entirely',
            blocks: [{ kind: 'text', text: 'working on it' }],
            startedAt: 1_700_000_000_000,
        });

        expect(after.pendingText).toBe('refactor this');
    });

    it('keeps a refused prompt and the refusal through a reconnect', () => {
        const refused = [
            { type: 'error', conversationId: CONV, code: 'bad_folder', message: 'the folder is gone' } as AgentConversationMessage,
        ].reduce(applyFrame, { ...emptyRuntime(CONV), userText: 'do the thing', pendingText: 'do the thing' });

        const after = applyFrame(refused, syncOf('t1', false));

        // A `sync` is the conversation's account of its own turn. The prompt it refused belongs to
        // no turn at all — nothing was spawned and nothing was recorded — so it is not in that frame,
        // and replacing the runtime wholesale would take the refused prompt and its refusal with it.
        //
        // The turn happens to have asked the same thing, which is the case the test above must not
        // be allowed to swallow: sending the same sentence twice is ordinary in a chat, and it is
        // the refusal, not the text, that says this prompt was never taken.
        expect(after.pendingText).toBe('do the thing');
        expect(after.lastError?.code).toBe('bad_folder');
    });
});

// The mode a pending card is answered under belongs to the turn that asked, not to the toolbar or
// to the conversation record: the record only learns the turn's mode when it settles, so in a tab
// that did not send the prompt both of those name the previous turn's mode for as long as the cards
// are up. Under `manualLive` that is the difference between a card that allows itself and one that
// waits, so it is the turn's account of itself that is kept.
describe('applyFrame — the mode the turn runs in', () => {
    it('has no mode before a turn has said what it is', () => {
        expect(emptyRuntime(CONV).permissionMode).toBeNull();
    });

    it('takes the mode from the start that opened the turn', () => {
        expect(fold(start('t1', 'manualLive')).permissionMode).toBe('manualLive');
    });

    it('takes it from a sync too, which is all a tab reconnecting mid-turn gets', () => {
        const after = applyFrame(emptyRuntime(CONV), {
            type: 'sync', permissionMode: 'manualLive', agent: 'claude',
            conversationId: CONV,
            turnId: 't1',
            running: true,
            userText: 'do the thing',
            blocks: [],
            pendingPermissions: [{ requestId: 'req-1', toolName: 'Write' }],
            startedAt: 1_700_000_000_000,
        });

        expect(after.permissionMode).toBe('manualLive');
    });

    it('adopts the new turn\'s mode rather than keeping the last one\'s', () => {
        expect(fold(start('t1', 'manualLive'), start('t2', 'manual')).permissionMode).toBe('manual');
    });
});

describe('applyFrame — how the turn ended', () => {
    // The two frames end a turn identically in every other way, and something driving a run of
    // prompts has to tell them apart: a turn somebody stopped is not an invitation to send the next.
    it('marks a turn that was stopped', () => {
        const runtime = fold(start('t1'), { type: 'stopped', conversationId: CONV, turnId: 't1' });
        expect(runtime.running).toBe(false);
        expect(runtime.stopped).toBe(true);
    });

    it('leaves a turn that finished unmarked', () => {
        const runtime = fold(start('t1'), { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 });
        expect(runtime.running).toBe(false);
        expect(runtime.stopped).toBe(false);
    });

    // It is a claim about one turn, and the next turn is a new one in every way.
    it('forgets it when the next turn starts', () => {
        const runtime = fold(
            start('t1'),
            { type: 'stopped', conversationId: CONV, turnId: 't1' },
            start('t2'),
        );
        expect(runtime.stopped).toBe(false);
    });

    // A refusal is not a stop: nothing was running to be stopped.
    it('does not mark a turn that was refused', () => {
        const runtime = fold(
            { type: 'error', conversationId: CONV, code: 'bad_folder', message: 'gone' },
        );
        expect(runtime.stopped).toBe(false);
    });

    // `sync` is the conversation's own account of its turn and carries no such flag, so a turn
    // arriving over one for the first time is not a turn this tab can call stopped.
    it('does not guess it for a turn a resync brought in', () => {
        const runtime = fold(
            start('t1'),
            { type: 'stopped', conversationId: CONV, turnId: 't1' },
            {
                type: 'sync',
                conversationId: CONV,
                turnId: 't2',
                running: false,
                userText: 'something else',
                blocks: [],
                permissionMode: 'manual',
                agent: 'claude',
                startedAt: 1_700_000_000_000,
            },
        );
        expect(runtime.stopped).toBe(false);
    });

    // …but a resync landing on the very turn it was said about must not lose it: the run watching
    // that turn is still waiting to hear how it ended.
    it('keeps it when the resync is about the same turn', () => {
        const runtime = fold(
            start('t1'),
            { type: 'stopped', conversationId: CONV, turnId: 't1' },
            {
                type: 'sync',
                conversationId: CONV,
                turnId: 't1',
                running: false,
                userText: 'the prompt',
                blocks: [],
                permissionMode: 'manual',
                agent: 'claude',
                startedAt: 1_700_000_000_000,
            },
        );
        expect(runtime.stopped).toBe(true);
    });
});

describe('applyFrame — the driver remarking on the turn', () => {
    const notice = (turnId: string, text: string): AgentConversationMessage =>
        ({ type: 'notice', conversationId: CONV, turnId, text });

    const syncOf = (turnId: string, running: boolean): AgentConversationMessage => ({
        type: 'sync', permissionMode: 'manual', agent: 'claude',
        conversationId: CONV,
        turnId,
        running,
        userText: 'do the thing',
        blocks: [{ kind: 'text', text: 'the whole reply' }],
        startedAt: 1_700_000_000_000,
    });

    it('shows the latest remark and nothing else', () => {
        const state = fold(start('t1'), output('t1', 'counting'), notice('t1', 'quiet for 2m0s'));

        expect(state.notice).toBe('quiet for 2m0s');
        // Not a block: it was never written anywhere, so the reply must read without it.
        expect(shape(state)).toEqual(['text:counting']);
    });

    it('lets each remark supersede the last', () => {
        const state = fold(start('t1'), notice('t1', 'quiet for 2m0s'), notice('t1', 'quiet for 4m0s'));

        expect(state.notice).toBe('quiet for 4m0s');
    });

    it('is fenced on the turn like everything else', () => {
        const state = fold(start('t1'), start('t2'));

        expect(applyFrame(state, notice('t1', 'straggler')).notice).toBeNull();
    });

    it('is gone with the turn that said it', () => {
        expect(fold(start('t1'), notice('t1', 'quiet'), { type: 'done', conversationId: CONV, turnId: 't1' }).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), { type: 'stopped', conversationId: CONV, turnId: 't1' }).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), { type: 'not_running', conversationId: CONV }).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), start('t2')).notice).toBeNull();
    });

    it('survives a resync of the running turn it is about, and nothing else', () => {
        const held = fold(start('t1'), notice('t1', 'quiet for 2m0s'));

        // The frame replays the turn's state but not its remarks; the quiet spell is still on,
        // and the remark names its own age.
        expect(applyFrame(held, syncOf('t1', true)).notice).toBe('quiet for 2m0s');
        expect(applyFrame(held, syncOf('t1', false)).notice).toBeNull();
        expect(applyFrame(held, syncOf('t2', true)).notice).toBeNull();
    });

    it('is cleared by a refusal that settles the turn, and kept by one it survives', () => {
        const settling = fold(
            start('t1'),
            notice('t1', 'quiet for 2m0s'),
            { type: 'error', conversationId: CONV, turnId: 't1', code: 'spawn_failed', message: 'no binary' },
        );
        expect(settling.notice).toBeNull();

        const surviving = fold(
            start('t1'),
            notice('t1', 'quiet for 2m0s'),
            { type: 'error', conversationId: CONV, turnId: 't1', code: 'cli_error', message: 'the stream stumbled' },
        );
        expect(surviving.notice).toBe('quiet for 2m0s');
    });

    it('is gone once the host speaks again', () => {
        // Thinking, text, a tool call, a question, a permission ask, a session id: every one of
        // them proves the quiet spell is over.
        expect(fold(start('t1'), notice('t1', 'quiet'), output('t1', 'back', 0, 'thinking')).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), output('t1', 'back')).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), toolUse('t1', 0, 'Read', 'a.md')).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), permissionRequest('t1', 'req-1')).notice).toBeNull();
        expect(fold(start('t1'), notice('t1', 'quiet'), questionRequest('t1', 'req-1')).notice).toBeNull();
        expect(fold(
            start('t1'),
            notice('t1', 'quiet'),
            { type: 'session', conversationId: CONV, turnId: 't1', sessionId: 'sess-1' },
        ).notice).toBeNull();
    });

    it('is kept by a re-pushed ask, which replays rather than speaks', () => {
        const held = fold(start('t1'), permissionRequest('t1', 'req-1'), notice('t1', 'quiet'));

        expect(applyFrame(held, permissionRequest('t1', 'req-1')).notice).toBe('quiet');
    });

    it('is kept by something said into the turn, which is the user speaking and not the host', () => {
        const state = fold(
            start('t1'),
            notice('t1', 'quiet'),
            { type: 'between', conversationId: CONV, turnId: 't1', text: 'carry on' },
        );

        expect(state.notice).toBe('quiet');
    });
});

describe('applyFrame — a delegation', () => {
    // A delegation arrives whole, like a tool call: set at its index, transcript and all, so a
    // live turn and a `sync` hold one through the same conversion.
    it('sets the delegation where it belongs, with what the child thought and did', () => {
        const state = fold(start('t1'), output('t1', 'Looking.', 0), delegation('t1', 1));

        expect(shape(state)).toEqual(['text:Looking.', 'subagent:child did things']);
        const held = state.blocks[1];
        if (held.kind !== 'subagent') throw new Error('not a delegation');
        expect(held.subagent.role).toBe('researcher');
        expect(held.subagent.objective).toBe('find the bug');
        expect(held.subagent.blocks.map(block => block.kind)).toEqual(['thinking', 'tool_use', 'text']);
    });

    it('reads the parent line where the delegation carries no transcript', () => {
        const bare: AgentConversationMessage = {
            type: 'subagent', conversationId: CONV, turnId: 't1', index: 0,
            kind: 'subagent', text: 'child did things',
        };
        const state = fold(start('t1'), bare);

        // What every delegation was before transcripts were filed beneath them.
        expect(shape(state)).toEqual(['text:child did things']);
    });

    it('proves the quiet spell over, the host having spoken', () => {
        const notice = (turnId: string, text: string): AgentConversationMessage =>
            ({ type: 'notice', conversationId: CONV, turnId, text });

        expect(fold(start('t1'), notice('t1', 'quiet'), delegation('t1', 0)).notice).toBeNull();
    });
});

describe('applyFrame — the background roster', () => {
    const roster = (turnId: string, tasks: AgentWireBackgroundTask[]): AgentConversationMessage =>
        ({ type: 'background', conversationId: CONV, turnId, tasks });

    const scout = (state: 'running' | 'waiting' | 'finished', status: string) => ({
        id: 'item-s1', kind: 'subagent', label: 'subagent "scout"', status, state, children: [],
    });

    const nightly = () => ({
        id: 'item-wf', kind: 'workflow', label: 'workflow "nightly"',
        status: 'inProgress', state: 'running' as const,
        children: [
            { childId: 'one', label: 'one', status: 'manualReconciliation', state: 'waiting' as const },
            { childId: 'two', label: 'two', status: 'completed', state: 'finished' as const, terminal: 'completed' },
        ],
    });

    it('replaces the roster whole rather than merging into it', () => {
        const state = fold(
            start('t1'),
            roster('t1', [scout('running', 'running'), nightly()]),
            roster('t1', [scout('finished', 'completed')]),
        );

        expect(state.background.map(task => task.id)).toEqual(['item-s1']);
        expect(state.background[0].state).toBe('finished');
    });

    it('carries a workflow with its folded children', () => {
        const state = fold(start('t1'), roster('t1', [nightly()]));

        const [held] = state.background;
        expect(held.children.map(child => `${child.childId}:${child.state}`))
            .toEqual(['one:waiting', 'two:finished']);
        expect(held.children[1].terminal).toBe('completed');
    });

    it('drops a roster from a turn we have already left', () => {
        const state = fold(start('t1'), roster('t1', [scout('running', 'running')]), start('t2'));

        const after = applyFrame(state, roster('t1', [scout('finished', 'completed')]));

        expect(after).toBe(state);
        expect(after.background).toEqual([]);
    });

    it('takes the roster from a sync, or an empty one where the turn handed nothing off', () => {
        const syncOf = (background?: AgentWireBackgroundTask[]): AgentConversationMessage => ({
            type: 'sync', permissionMode: 'manual', agent: 'claude',
            conversationId: CONV, turnId: 't1', running: true, userText: 'do the thing',
            blocks: [], background, startedAt: 1_700_000_000_000,
        });

        const withRoster = applyFrame(emptyRuntime(CONV), syncOf([nightly()]));
        expect(withRoster.background.map(task => task.id)).toEqual(['item-wf']);

        // A reconnecting tab is repaired by replacement: what it held is gone.
        const held = fold(start('t1'), roster('t1', [scout('running', 'running')]));
        expect(applyFrame(held, syncOf(undefined)).background).toEqual([]);
    });

    it('settles whatever is still open when the turn ends', () => {
        const open = fold(start('t1'), roster('t1', [scout('running', 'running'), nightly()]));

        for (const end of [
            { type: 'done', conversationId: CONV, turnId: 't1', exitCode: 0 },
            { type: 'stopped', conversationId: CONV, turnId: 't1' },
        ] as AgentConversationMessage[]) {
            const after = applyFrame(open, end);
            const [task, workflow] = after.background;
            expect(task.state).toBe('finished');
            expect(task.status).toBe('abandoned');
            expect(workflow.children[0].state).toBe('finished');
            expect(workflow.children[0].status).toBe('abandoned');
            // What landed keeps its verdict: settling is about the wait, not the work.
            expect(workflow.children[1].status).toBe('completed');
        }
    });

    it('settles the roster on a refusal nothing was spawned for, and keeps it past a mid-turn complaint', () => {
        const open = fold(start('t1'), roster('t1', [scout('running', 'running')]));

        const refused = applyFrame(open, {
            type: 'error', conversationId: CONV, code: 'spawn_failed', message: 'no CLI here',
        });
        expect(refused.background[0].state).toBe('finished');
        expect(refused.background[0].status).toBe('abandoned');

        const complained = applyFrame(open, {
            type: 'error', conversationId: CONV, turnId: 't1', code: 'cli_error', message: 'a tool blew up',
        });
        expect(complained.background[0].state).toBe('running');
    });

    it('clears the roster with the turn nobody holds', () => {
        const held = fold(start('t1'), roster('t1', [scout('running', 'running')]));

        const after = applyFrame(held, { type: 'not_running', conversationId: CONV });

        expect(after.background).toEqual([]);
    });

    it('proves the quiet spell over, the host having spoken', () => {
        const notice = (turnId: string, text: string): AgentConversationMessage =>
            ({ type: 'notice', conversationId: CONV, turnId, text });

        expect(fold(start('t1'), notice('t1', 'quiet'), roster('t1', [])).notice).toBeNull();
    });
});
