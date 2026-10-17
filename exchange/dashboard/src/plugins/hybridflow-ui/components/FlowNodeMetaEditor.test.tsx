import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from 'src/test/render';

// Two engines, so the editor can be asked the one thing only a second engine makes visible: that
// the lists beside the agent select are its *platform's* lists.
const TEST_AGENTS = await vi.hoisted(async () => {
    const { agentOptions } = await import('src/test/agents');
    return [
        agentOptions({
            models: [{ value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }],
            efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
        }),
        agentOptions({
            value: 'codex', label: 'Codex',
            models: [{ value: 'gpt-5.1-codex', label: 'gpt-5.1-codex' }],
            efforts: [{ value: 'medium', label: 'Medium' }],
            permissionModes: [{ value: 'bypassPermissions', label: 'Bypass permissions' }],
        }),
    ];
});

// Three managed agents, two of them on one platform: picking between those two keeps the effort
// and the mode, and picking across platforms takes them back.
const TEST_MANAGED = vi.hoisted(() => [
    {
        id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus',
        createdAt: '', updatedAt: '', revision: 1,
    },
    {
        id: 'agent-2', name: 'Runner', platform: 'codex', model: 'gpt-5.1-codex',
        createdAt: '', updatedAt: '', revision: 1,
    },
    {
        id: 'agent-3', name: 'Writer', platform: 'claude', model: 'haiku',
        createdAt: '', updatedAt: '', revision: 1,
    },
]);

vi.mock('@cms-kit/capabilities', () => ({
    useChatOptions: () => ({
        agents: TEST_AGENTS,
        optionsFor: (agent: string) => TEST_AGENTS.find(one => one.value === agent) ?? TEST_AGENTS[0],
    }),
}));

vi.mock('../Agents-ctx', () => ({
    useAgents: () => ({ agents: TEST_MANAGED, loading: false, error: null }),
}));

import { writeDraggedFiles } from '@cms-core';
import { FlowNodeMetaEditor } from './FlowNodeMetaEditor';
import type { FlowNodeSettings } from '../flowNodeSettings';
import type { FlowNodeType } from '../flowNodeType';

const onChange = vi.fn();
const onSchedule = vi.fn();

/** The type is a field, but a card holding an agent is an AI card: that is how a board is read. */
const show = (settings: FlowNodeSettings, type?: FlowNodeType, at = '') => render(
    <FlowNodeMetaEditor
        type={type ?? (settings.agent || settings.model ? 'ai' : 'human')}
        settings={settings}
        at={at}
        onChange={onChange}
        onSchedule={onSchedule}
    />,
);

/** One of the selects. Its label is on the box, which antd also puts on the input inside it. */
const selectBox = (label: string) =>
    document.querySelector<HTMLElement>(`.ant-select[aria-label="${label}"]`)!;

/** Opens a select and takes the choice named. rc-select titles both the box and its options. */
const choose = (label: string, option: string) => {
    fireEvent.mouseDown(selectBox(label).querySelector('.ant-select-content')!);
    fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FlowNodeMetaEditor', () => {
    // The kind was decided when the card was made, so it is not asked here at all: no select
    // offers it, on an agent's card or on anyone else's.
    it('offers no type selector', () => {
        show({ agent: 'agent-1' });
        expect(selectBox('Node type')).toBeNull();
    });

    // A flow node whose document says nothing about an agent is one a person does — a board written
    // before the type field, or by hand — and nothing about a played turn is even asked.
    it('asks a flow node that says nothing nothing about a turn', () => {
        show({});
        expect(selectBox('Agent')).toBeNull();
        expect(selectBox('Effort')).toBeNull();
        expect(selectBox('Permission mode')).toBeNull();
        expect(screen.getByLabelText('Working directory')).toHaveValue('');
    });

    // The agent is what says the flow node is an agent's, so a flow node naming one is AI, and the two
    // questions about the turn are put to it beside the agent itself.
    it('asks a flow node naming an agent what plays it', () => {
        show({ agent: 'agent-1' });
        expect(selectBox('Agent')).toHaveTextContent('Reviewer');
        expect(selectBox('Effort')).toBeTruthy();
        expect(selectBox('Permission mode')).toBeTruthy();
    });

    // A card written before managed agents names the engine itself: read as AI all the same.
    it('shows a flow node naming an engine and a model as AI', () => {
        show({ agent: 'claude', model: 'opus' });
        expect(selectBox('Agent')).toHaveTextContent('claude / opus');
    });

    // The placeholder is a question rather than a value: nothing is picked until somebody picks it.
    it('leaves the effort empty for a flow node that names none', () => {
        show({ agent: 'agent-1' });
        // The placeholder rather than a value: nothing is chosen in that box.
        expect(selectBox('Effort').querySelector('.ant-select-placeholder')).toHaveTextContent('Effort');
        expect(selectBox('Effort').querySelector('.ant-select-content-value')).toBeNull();
    });

    // Part of the set is not a choice, and the card of such a flow node has no Play button to explain
    // itself. The permission select and the folder are marked like the effort: not one of them is a
    // line the board fills in for you.
    it('marks an agent still waiting on an effort, a mode or a folder', () => {
        show({ agent: 'agent-1' });
        expect(selectBox('Effort').className).toContain('ant-select-status-warning');
        expect(selectBox('Permission mode').className).toContain('ant-select-status-warning');
        expect(screen.getByLabelText('Working directory').closest('.ant-input-outlined')!.className)
            .toContain('ant-input-status-warning');
    });

    it('marks the folder alone once the effort and the mode are picked', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'manual' });
        expect(selectBox('Effort').className).not.toContain('ant-select-status-warning');
        expect(selectBox('Permission mode').className).not.toContain('ant-select-status-warning');
        expect(screen.getByLabelText('Working directory').closest('.ant-input-outlined')!.className)
            .toContain('ant-input-status-warning');
    });

    it('marks nothing once all four have been given', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'manual', folder: '/exchange' });
        expect(selectBox('Effort').className).not.toContain('ant-select-status-warning');
        expect(selectBox('Permission mode').className).not.toContain('ant-select-status-warning');
        expect(screen.getByLabelText('Working directory').closest('.ant-input-outlined')!.className)
            .not.toContain('ant-input-status-warning');
    });

    // The placeholder is the question, since there is no folder a flow node falls back to — and it says
    // how the one folder that cannot be typed, the store root, is asked for.
    it('asks for a folder rather than offering one', () => {
        show({});
        expect(screen.getByLabelText('Working directory'))
            .toHaveAttribute('placeholder', 'Folder (/ is the store root)');
    });

    it('writes the agent that is picked', () => {
        show({ agent: 'agent-1' });
        choose('Agent', 'Runner');
        expect(onChange).toHaveBeenCalledWith({
            agent: 'agent-2', model: undefined, effort: undefined, permission: undefined,
        });
    });

    // A Shutdown has no options at all: playing it is the whole of what it does.
    it('asks a Shutdown card nothing', () => {
        show({}, 'shutdown');
        expect(selectBox('Agent')).toBeNull();
        expect(selectBox('Effort')).toBeNull();
        expect(selectBox('Permission mode')).toBeNull();
        expect(screen.queryByLabelText('Working directory')).toBeNull();
        expect(screen.queryByLabelText('Scheduled for')).toBeNull();
    });

    // The datetime is the one thing it is asked, and nothing else is.
    it('asks a Scheduler for its datetime and for nothing else', () => {
        show({}, 'scheduler', '2026-09-03T22:00');
        expect(screen.getByLabelText('Scheduled for')).toHaveValue('2026-09-03T22:00');
        expect(selectBox('Agent')).toBeNull();
        expect(screen.queryByLabelText('Working directory')).toBeNull();
    });

    // Empty rather than defaulted, like the effort: there is no hour the board could pick for you.
    it('marks a Scheduler that names no datetime', () => {
        show({}, 'scheduler');
        expect(screen.getByLabelText('Scheduled for').closest('.ant-input-outlined')!.className)
            .toContain('ant-input-status-warning');
    });

    it('writes the datetime that is picked', () => {
        show({}, 'scheduler');
        fireEvent.change(screen.getByLabelText('Scheduled for'), { target: { value: '2026-09-03T22:00' } });
        expect(onSchedule).toHaveBeenCalledWith('2026-09-03T22:00', '');
    });

    it('switches to a fixed duration, saves the wait, then switches back', () => {
        show({}, 'scheduler', '2026-09-03T22:00');
        choose('Schedule mode', 'Fixed duration');
        expect(onSchedule).toHaveBeenLastCalledWith('', '');
        expect(screen.queryByLabelText('Scheduled for')).toBeNull();
        const duration = screen.getByLabelText('Duration');
        fireEvent.change(duration, { target: { value: '1h30m' } });
        fireEvent.blur(duration);
        expect(onSchedule).toHaveBeenLastCalledWith('', '1h30m');
        choose('Schedule mode', 'Date time');
        expect(onSchedule).toHaveBeenLastCalledWith('', '');
        expect(screen.getByLabelText('Scheduled for')).toBeInTheDocument();
    });

    it('keeps an invalid duration marked without replacing the saved schedule', () => {
        show({}, 'scheduler');
        choose('Schedule mode', 'Fixed duration');
        onSchedule.mockClear();
        const duration = screen.getByLabelText('Duration');
        fireEvent.change(duration, { target: { value: '-2h' } });
        fireEvent.blur(duration);
        expect(onSchedule).not.toHaveBeenCalled();
        expect(duration.className).toContain('ant-input-status-warning');
    });

    it('writes the effort that is picked', () => {
        show({ agent: 'agent-1' });
        choose('Effort', 'High');
        expect(onChange).toHaveBeenCalledWith({ effort: 'high' });
    });

    // The folder is the one setting asked of every flow node: where the work is is worth writing down on
    // a card somebody will do by hand, and a flow node handed to an agent later arrives with it already
    // said. It is only *required* of an agent's, so nothing is marked here.
    it('asks a flow node that is nobody\u2019s where it is all the same', () => {
        show({ folder: '/exchange' });
        const box = screen.getByLabelText('Working directory');
        expect(box).not.toBeDisabled();
        expect(box).toHaveValue('/exchange');

        fireEvent.change(box, { target: { value: '/exchange/dashboard' } });
        expect(onChange).toHaveBeenCalledWith({ folder: '/exchange/dashboard' });
    });

    it('marks no folder as missing on a flow node nobody plays', () => {
        show({});
        expect(screen.getByLabelText('Working directory').closest('.ant-input-outlined')!.className)
            .not.toContain('ant-input-status-warning');
    });

    // There is no mode to fall back to, so the box shows a question like the effort's rather than
    // the name of a default nobody picked. Every option in the list is a mode.
    it('leaves the permission mode empty for a flow node that names none', () => {
        show({ agent: 'agent-1', effort: 'high' });
        const box = selectBox('Permission mode');
        expect(box.querySelector('.ant-select-placeholder')).toHaveTextContent('Permission');
        expect(box.querySelector('.ant-select-content-value')).toBeNull();
        expect(box).not.toHaveTextContent('Manual Live');
    });

    it('writes the permission mode that is picked', () => {
        show({ agent: 'agent-1', effort: 'high' });
        choose('Permission mode', 'Bypass permissions');
        expect(onChange).toHaveBeenCalledWith({ permission: 'bypassPermissions' });
    });

    // A deployment may withdraw `bypassPermissions` after a flow node has already asked for it. What the
    // flow node holds is what the select shows: an empty box would say the line was not there. The box
    // shows the short name, as for any other mode.
    it('shows a mode the deployment no longer offers', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'someOtherMode' });
        expect(selectBox('Permission mode')).toHaveTextContent('some');
    });

    // The three selects share one line, so the panel stays short: the agent, the effort and the
    // permission mode are one row rather than three.
    it('keeps the agent, the effort and the permission mode on one line', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'manual' });
        const row = selectBox('Agent').closest('div[class*="metaRow"]')!;
        expect(row.contains(selectBox('Effort'))).toBe(true);
        expect(row.contains(selectBox('Permission mode'))).toBe(true);
    });

    // The box shows the short name so the three fit: `bypassPermissions` as `bypass`.
    // The list keeps the full names the choice is picked from.
    it('shows the permission mode by its short name', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'bypassPermissions' });
        expect(selectBox('Permission mode')).toHaveTextContent('bypass');
        expect(selectBox('Permission mode')).not.toHaveTextContent('Bypass permissions');
    });

    it('shows manualLive as live', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'manualLive' });
        expect(selectBox('Permission mode')).toHaveTextContent('live');
    });

    // What is typed is written down as a link, whether or not the slash was typed with it: the link
    // fixer follows a reference only when it carries one, and a flow node's folder is a reference.
    it('writes what is typed as a link to the working directory', () => {
        show({ agent: 'agent-1', effort: 'high' });
        fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: 'exchange' } });
        expect(onChange).toHaveBeenCalledWith({ folder: '/exchange' });
    });

    // An empty box is not an empty folder — it is no line at all, which leaves the flow node unplayable.
    it('takes the line out when the box is emptied', () => {
        show({ agent: 'agent-1', effort: 'high', folder: '/exchange' });
        fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith({ folder: undefined });
    });

    // The folder box also takes what is dragged onto it out of the file tree or the file browser,
    // which is shorter than typing a path and cannot misspell one.
    describe('a file dragged onto the folder box', () => {
        /** jsdom builds no DataTransfer; the bag both ends of a drag use stands in for it. */
        const dragOf = (path: string, isDirectory: boolean): DataTransfer => {
            const store: Record<string, string> = {};
            const data = {
                get types() { return Object.keys(store); },
                setData: (type: string, value: string) => { store[type] = value; },
                getData: (type: string) => store[type] ?? '',
                effectAllowed: 'none',
                dropEffect: 'none',
            } as unknown as DataTransfer;
            writeDraggedFiles(data, [{ path, isDirectory }]);
            return data;
        };

        const folderBox = () => screen.getByLabelText('Working directory');

        it('fills the box with a dropped folder', () => {
            show({ agent: 'agent-1', effort: 'high' });
            fireEvent.drop(folderBox(), { dataTransfer: dragOf('exchange/dashboard', true) });
            expect(onChange).toHaveBeenCalledWith({ folder: '/exchange/dashboard' });
        });

        // A file dropped on a box asking *where to run* says here, not me.
        it('fills it with the folder holding a dropped file', () => {
            show({ agent: 'agent-1', effort: 'high' });
            fireEvent.drop(folderBox(), { dataTransfer: dragOf('exchange/dashboard/README.md', false) });
            expect(onChange).toHaveBeenCalledWith({ folder: '/exchange/dashboard' });
        });

        // `''` is the one folder that cannot be written down, and an empty box is an unplayable flow node.
        it('writes the store root as the / the box asks for', () => {
            show({ agent: 'agent-1', effort: 'high' });
            fireEvent.drop(folderBox(), { dataTransfer: dragOf('notes.md', false) });
            expect(onChange).toHaveBeenCalledWith({ folder: '/' });
        });

        it('marks the box while the drag is over it, and unmarks it on the way out', () => {
            show({ agent: 'agent-1', effort: 'high' });
            const taken = fireEvent.dragOver(folderBox(), { dataTransfer: dragOf('exchange', true) });
            // A dragover left at its default is a drop the browser refuses.
            expect(taken).toBe(false);
            expect(document.querySelector('[class*="metaFolderDrop"]')).toBeTruthy();

            fireEvent.dragLeave(folderBox());
            expect(document.querySelector('[class*="metaFolderDrop"]')).toBeFalsy();
        });

        it('leaves a drag that is not the store’s to the browser', () => {
            show({ agent: 'agent-1', effort: 'high' });
            const prose = {
                types: ['text/plain'],
                getData: () => 'some dragged prose',
                setData: () => undefined,
            } as unknown as DataTransfer;

            expect(fireEvent.dragOver(folderBox(), { dataTransfer: prose })).toBe(true);
            fireEvent.drop(folderBox(), { dataTransfer: prose });
            expect(onChange).not.toHaveBeenCalled();
        });
    });
});


// ── Which agent plays the card ────────────────────────────────────────────────
//
// The agent is the first of the four settings: one of the managed agents the store keeps, picked
// by name, and the effort and the permission mode beside it are its platform's vocabulary.

describe('the agent a card is played on', () => {
    it('is shown on an AI card, and on no other', () => {
        show({ agent: 'agent-1' });
        expect(selectBox('Agent')).toHaveTextContent('Reviewer');

        onChange.mockClear();
        show({ folder: 'units' }, 'human');
        expect(document.querySelectorAll('.ant-select[aria-label="Agent"]')).toHaveLength(1);
    });

    // The lists beside it are its platform's own. A card on a Codex agent is offered Codex's
    // efforts and Codex's one permission mode, and never Claude's — which is the whole reason the
    // platform is read off the agent.
    it('decides the lists the two selects beside it offer', () => {
        show({ agent: 'agent-2' });
        fireEvent.mouseDown(selectBox('Effort').querySelector('.ant-select-content')!);
        expect(document.querySelector('.ant-select-item-option[title="Medium"]')).not.toBeNull();
        expect(document.querySelector('.ant-select-item-option[title="High"]')).toBeNull();
    });

    // Changing it across platforms takes the two with it: they were the previous platform's
    // vocabulary, and a card left holding them would read as answered and play as refused. The
    // legacy model goes whatever the platform.
    it('clears what belonged to the platform it left', () => {
        show({ agent: 'agent-1', model: 'opus', effort: 'high', permission: 'manual', folder: 'units' });
        choose('Agent', 'Runner');
        expect(onChange).toHaveBeenCalledWith({
            agent: 'agent-2', model: undefined, effort: undefined, permission: undefined,
        });
    });

    // Between two agents of one platform there is nothing to take back: the effort and the mode
    // are this platform's vocabulary either way.
    it('keeps the effort and the mode where the platform stays', () => {
        show({ agent: 'agent-1', effort: 'high', permission: 'manual', folder: 'units' });
        choose('Agent', 'Writer');
        expect(onChange).toHaveBeenCalledWith({ agent: 'agent-3', model: undefined });
    });

    // A board travels, and a card whose engine is not installed here has to be readable before it
    // can be changed. The engine and the model are still an answer: nothing is marked.
    it('shows a card written before managed agents as the engine and the model', () => {
        show({ agent: 'gemini', model: 'flash' });
        expect(selectBox('Agent')).toHaveTextContent('gemini / flash');
        expect(selectBox('Agent').className).not.toContain('ant-select-status-warning');
    });

    // An id nothing holds is an agent that has gone: shown as gone rather than as a box that looks
    // unanswered — and marked, since the card names nothing to play it.
    it('shows an agent the store does not hold as unknown', () => {
        show({ agent: 'agent-gone' });
        expect(selectBox('Agent')).toHaveTextContent('Unknown agent');
        expect(selectBox('Agent').className).toContain('ant-select-status-warning');
    });
});
