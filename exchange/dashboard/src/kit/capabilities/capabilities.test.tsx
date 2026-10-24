import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The registry, stood in for: what is under test is what the kit does with what it is handed, and a
// plugin list is a heavier way of saying the same thing.
const published = vi.hoisted(() => ({ registry: {} as Record<string, unknown[]> }));

vi.mock('@cms-core', () => ({
    usePluginCapabilities: () => published.registry,
}));

import {
    useChatOptions, useChatRun, useChatRunAvailable, useCapability, useShowChat,
} from './index';

const CLAUDE = {
    value: 'claude', label: 'Claude',
    models: [{ value: 'opus', label: 'Opus' }],
    efforts: [{ value: 'high', label: 'High' }],
    permissionModes: [{ value: 'manual', label: 'Manual' }],
};

const CODEX = {
    value: 'codex', label: 'Codex',
    models: [{ value: 'gpt-5.1-codex', label: 'gpt-5.1-codex' }],
    efforts: [{ value: 'medium', label: 'Medium' }],
    permissionModes: [{ value: 'bypassPermissions', label: 'Bypass permissions' }],
};

/** One publisher of `chat.options`, offering the agents it is given. */
const optionsProvider = (...agents: typeof CLAUDE[]) => ({ useChatOptions: () => ({ agents }) });

const Agents: React.FC = () => {
    const { agents, optionsFor } = useChatOptions();
    return (
        <>
            <span data-testid="agents">{agents.map(agent => agent.value).join(',')}</span>
            <span data-testid="codex-models">
                {optionsFor('codex').models.map(model => model.value).join(',')}
            </span>
            <span data-testid="unknown-models">
                {optionsFor('gemini').models.map(model => model.value).join(',') || '(none)'}
            </span>
        </>
    );
};

beforeEach(() => { published.registry = {}; });

describe('a name with no publisher', () => {
    it('is an empty list rather than a throw', () => {
        const Probe = () => <span data-testid="n">{useCapability('chat.run').length}</span>;
        render(<Probe />);
        expect(screen.getByTestId('n').textContent).toBe('0');
    });

    // The board draws no Play button at all rather than one that does nothing.
    it('leaves the runs unavailable and inert', () => {
        const Probe = () => {
            const { runs } = useChatRun();
            return <span data-testid="n">{`${useChatRunAvailable()}|${runs.length}`}</span>;
        };
        render(<Probe />);
        expect(screen.getByTestId('n').textContent).toBe('false|0');
    });

    it('offers no agent, so no card is playable', () => {
        render(<Agents />);
        expect(screen.getByTestId('agents').textContent).toBe('');
    });
});

describe('several publishers of one name', () => {
    // The point of the list: a registry that kept one publisher would drop the others in silence.
    it('are all kept, in assembly order', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE), optionsProvider(CODEX)] };
        const Probe = () => <span data-testid="n">{useCapability('chat.options').length}</span>;
        render(<Probe />);
        expect(screen.getByTestId('n').textContent).toBe('2');
    });

    // Offering agents is a list by nature: two plugins each driving an engine are two agents to
    // choose from, exactly as one plugin driving two is.
    it('have their agents gathered, and each keeps its own lists', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE), optionsProvider(CODEX)] };
        render(<Agents />);
        expect(screen.getByTestId('agents').textContent).toBe('claude,codex');
        expect(screen.getByTestId('codex-models').textContent).toBe('gpt-5.1-codex');
    });

    // Two offers of the same agent are one agent, and the earlier publisher is the one that stands.
    it('keep a name published twice only once', () => {
        published.registry = {
            'chat.options': [optionsProvider(CLAUDE, CODEX), optionsProvider({ ...CODEX, label: 'Other' })],
        };
        render(<Agents />);
        expect(screen.getByTestId('agents').textContent).toBe('claude,codex');
    });

    // Showing a chat and playing a flow node must happen exactly once, so the first publisher answers.
    it('let the first answer for anything that happens exactly once', () => {
        const first = vi.fn();
        const second = vi.fn();
        published.registry = {
            'chat.show': [{ useShowChat: () => first }, { useShowChat: () => second }],
        };
        const Probe = () => { useShowChat()('conv-1'); return null; };
        render(<Probe />);
        expect(first).toHaveBeenCalledWith('conv-1');
        expect(second).not.toHaveBeenCalled();
    });
});

// An agent nothing offers is empty lists and not the first agent's: a card naming an engine this
// host does not have must not be read against another one's catalogue.
describe('an agent this assembly cannot drive', () => {
    it('offers nothing rather than somebody else’s catalogue', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE, CODEX)] };
        render(<Agents />);
        expect(screen.getByTestId('unknown-models').textContent).toBe('(none)');
    });
});
