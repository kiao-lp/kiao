import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The registry is mocked; the kit logic is under test.
const published = vi.hoisted(() => ({ registry: {} as Record<string, unknown[]> }));

vi.mock('@kiao-dashboard-core', () => ({
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

const optionsProvider = (...harnesses: typeof CLAUDE[]) => ({ useChatOptions: () => ({ harnesses }) });

const Harnesses: React.FC = () => {
    const { harnesses, optionsFor } = useChatOptions();
    return (
        <>
            <span data-testid="harnesses">{harnesses.map(harness => harness.value).join(',')}</span>
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

    // No Play button when runs are unavailable.
    it('leaves the runs unavailable and inert', () => {
        const Probe = () => {
            const { runs } = useChatRun();
            return <span data-testid="n">{`${useChatRunAvailable()}|${runs.length}`}</span>;
        };
        render(<Probe />);
        expect(screen.getByTestId('n').textContent).toBe('false|0');
    });

    it('offers no harness, so no card is playable', () => {
        render(<Harnesses />);
        expect(screen.getByTestId('harnesses').textContent).toBe('');
    });
});

describe('several publishers of one name', () => {
    it('are all kept, in assembly order', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE), optionsProvider(CODEX)] };
        const Probe = () => <span data-testid="n">{useCapability('chat.options').length}</span>;
        render(<Probe />);
        expect(screen.getByTestId('n').textContent).toBe('2');
    });

    it('have their harnesses gathered, and each keeps its own lists', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE), optionsProvider(CODEX)] };
        render(<Harnesses />);
        expect(screen.getByTestId('harnesses').textContent).toBe('claude,codex');
        expect(screen.getByTestId('codex-models').textContent).toBe('gpt-5.1-codex');
    });

    it('keep a name published twice only once', () => {
        published.registry = {
            'chat.options': [optionsProvider(CLAUDE, CODEX), optionsProvider({ ...CODEX, label: 'Other' })],
        };
        render(<Harnesses />);
        expect(screen.getByTestId('harnesses').textContent).toBe('claude,codex');
    });

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

describe('a harness this assembly cannot drive', () => {
    it('offers nothing rather than somebody else’s catalogue', () => {
        published.registry = { 'chat.options': [optionsProvider(CLAUDE, CODEX)] };
        render(<Harnesses />);
        expect(screen.getByTestId('unknown-models').textContent).toBe('(none)');
    });
});
