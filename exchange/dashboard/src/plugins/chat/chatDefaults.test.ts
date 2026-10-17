import { describe, it, expect } from 'vitest';
import type { AgentOptionsEntry } from 'kiao-worker';
import { defaultModelEffortFor } from './chatDefaults';

// ── Why this file exists ──────────────────────────────────────────────────────
//
// The pair the toolbar shows until a conversation is selected is the service's own — Claude at
// `opus`/`max`, Muse on its newest Spark contributor build at `max` — and the client's fallback
// only answers where the service has no opinion (Codex) or is too old to say. What is pinned here
// is that the advertised pair wins, that a pair the lists do not hold is ignored rather than
// shown, and that the fallback spends the least.

const entry = (overrides: Partial<AgentOptionsEntry> = {}): AgentOptionsEntry => ({
    value: 'claude',
    label: 'Claude',
    models: [
        { value: 'opus', label: 'Opus' },
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'haiku', label: 'Haiku' },
    ],
    efforts: [
        { value: 'low', label: 'Low' },
        { value: 'max', label: 'Max' },
    ],
    permissionModes: [{ value: 'manual', label: 'Manual' }],
    ...overrides,
});

describe('defaultModelEffortFor', () => {
    it('takes the pair the service advertises', () => {
        expect(defaultModelEffortFor(entry({ defaultModel: 'opus', defaultEffort: 'max' })))
            .toEqual({ model: 'opus', effort: 'max' });
    });

    it('takes each half on its own, where only one is advertised', () => {
        // A service that names a model and no effort gets its model at the fallback effort, and
        // not the fallback pair whole.
        expect(defaultModelEffortFor(entry({ defaultModel: 'sonnet' })))
            .toEqual({ model: 'sonnet', effort: 'low' });
    });

    it('ignores an advertised pair the lists do not hold', () => {
        // A default no select offers is worse than none: the toolbar would show a value that is
        // not a choice.
        expect(defaultModelEffortFor(entry({ defaultModel: 'gpt-5', defaultEffort: 'ultra' })))
            .toEqual({ model: 'haiku', effort: 'low' });
    });

    it('falls back to cheapest + lightest where the service has no opinion', () => {
        // Codex advertises neither half, and a service too old to advertise reads the same way.
        expect(defaultModelEffortFor(entry({
            value: 'codex',
            models: [{ value: 'gpt-5.6', label: 'GPT-5.6' }],
            efforts: [{ value: 'medium', label: 'Medium' }],
        }))).toEqual({ model: 'gpt-5.6', effort: 'medium' });
    });

    it('answers empty where there is nothing to offer', () => {
        expect(defaultModelEffortFor(entry({ models: [], efforts: [] })))
            .toEqual({ model: '', effort: '' });
    });
});
