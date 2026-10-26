import React from 'react';
import { vi } from 'vitest';

/** Fresh spies on every call. Safe to import inside an async vi.hoisted callback. */
export const mockFunctions = <K extends string>(...names: K[]) =>
    Object.fromEntries(names.map(name => [name, vi.fn()])) as Record<K, ReturnType<typeof vi.fn>>;

/** A synchronous external value, for mocks consumed by multiple mounted readers. */
export const createExternalStore = <T,>(initial: T) => {
    const listeners = new Set<() => void>();
    const store = {
        value: initial,
        set: (next: T) => { store.value = next; listeners.forEach(listener => listener()); },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        getSnapshot: () => store.value,
    };
    return store;
};

/** Transparent stand-in for wrappers whose behaviour belongs to another suite. */
export const Children = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

export const tagUiMock = () => ({
    TagChips: ({ labels }: { labels?: string[] }) => (
        <>{(labels ?? []).map(label => <span key={label} data-testid="tag-chip">{label}</span>)}</>
    ),
    TagPicker: () => null,
});

export const VoiceTextArea = ({ value, onChange }: {
    value?: string; onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
}) => <textarea data-testid="value-field" value={value} onChange={onChange} />;
