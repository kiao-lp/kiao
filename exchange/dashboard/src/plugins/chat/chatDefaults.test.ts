import { describe, it, expect } from 'vitest';
import type { HarnessOptionsEntry } from 'kiao-worker';
import { defaultModelEffortFor } from './chatDefaults';


const entry = (overrides: Partial<HarnessOptionsEntry> = {}): HarnessOptionsEntry => ({
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
        expect(defaultModelEffortFor(entry({ defaultModel: 'sonnet' })))
            .toEqual({ model: 'sonnet', effort: 'low' });
    });

    it('ignores an advertised pair the lists do not hold', () => {
        expect(defaultModelEffortFor(entry({ defaultModel: 'gpt-5', defaultEffort: 'ultra' })))
            .toEqual({ model: 'haiku', effort: 'low' });
    });

    it('falls back to cheapest + lightest where the service has no opinion', () => {
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

it('preserves provider paths and local model tags when separating effort', async () => {
    const { splitModelEffort } = await import('./chatDefaults');
    expect(splitModelEffort('local/qwen:latest:off')).toEqual({ model: 'local/qwen:latest', effort: 'off' });
    expect(splitModelEffort('gateway/org/model:high')).toEqual({ model: 'gateway/org/model', effort: 'high' });
});
