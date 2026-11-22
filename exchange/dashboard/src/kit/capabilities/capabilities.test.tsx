import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCapability, useTagsAvailable, useTagsUi } from './index';

const published = vi.hoisted(() => ({ registry: {} as Record<string, unknown[]> }));
vi.mock('@kiao-dashboard-core', () => ({
    usePluginCapabilities: () => published.registry,
}));

it('supplies empty tag controls without a provider', () => {
    published.registry = {};
    const { result } = renderHook(() => ({
        providers: useCapability('tags.ui'), available: useTagsAvailable(), ui: useTagsUi(),
    }));
    expect(result.current.providers).toEqual([]);
    expect(result.current.available).toBe(false);
});

it('keeps all providers in assembly order and uses the first for tag controls', () => {
    const first = { TagChips: vi.fn(), TagPicker: vi.fn() };
    const second = { TagChips: vi.fn(), TagPicker: vi.fn() };
    published.registry = { 'tags.ui': [first, second] };
    const { result } = renderHook(() => ({
        providers: useCapability('tags.ui'), available: useTagsAvailable(), ui: useTagsUi(),
    }));
    expect(result.current.providers).toEqual([first, second]);
    expect(result.current.available).toBe(true);
    expect(result.current.ui).toBe(first);
});
