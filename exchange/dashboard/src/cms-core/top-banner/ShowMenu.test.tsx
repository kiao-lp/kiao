import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** The same stand-in as the tool bars' own tests: one scope bag per document, one app-wide. */
const state = vi.hoisted(() => ({
    path: 'first.md',
    files: {} as Record<string, Record<string, any>>,
    global: {} as Record<string, any>,
}));

vi.mock('src/cms-core/view-state', async () => {
    const React = await import('react');
    const scoped = (bag: () => Record<string, any>, key: string, defaults: any) => {
        const [, bump] = React.useState(0);
        const defaultsRef = React.useRef(defaults);
        const value = { ...defaultsRef.current, ...(bag()[key] ?? {}) };
        const update = React.useCallback((updater: any) => {
            const previous = { ...defaultsRef.current, ...(bag()[key] ?? {}) };
            const patch = typeof updater === 'function' ? updater(previous) : updater;
            const next = { ...previous, ...patch };
            if (JSON.stringify(next) === JSON.stringify(bag()[key])) return;
            bag()[key] = next;
            bump((n: number) => n + 1);
        }, []);
        return [value, update];
    };
    return {
        useFileViewState: (key: string, defaults: any) =>
            scoped(() => (state.files[state.path] ??= {}), key, defaults),
        useGlobalViewState: (key: string, fallback: any) => scoped(() => state.global, key, fallback),
    };
});

import { ToolBarTab, ToolBarTabRegistration, ToolBarsProvider } from '../tool-bars/ToolBars-ctx';
import { useShowMenuItems } from './ShowMenu';

const tab = (id: string, extra?: Partial<ToolBarTab>): ToolBarTab => ({
    id,
    title: id,
    render: () => null,
    ...extra,
});

const Probe: React.FC = () => {
    const items = useShowMenuItems() ?? [];
    const show = items[0] as unknown as { children?: { key: string }[] } | undefined;
    const keys = (show?.children ?? []).map(child => child.key);
    return <div data-testid="show-keys">{keys.join(',')}</div>;
};

const Harness: React.FC<{ tabs: ToolBarTab[] }> = ({ tabs }) => (
    <ToolBarsProvider>
        {tabs.map(t => <ToolBarTabRegistration key={t.id} tab={t} />)}
        <Probe />
    </ToolBarsProvider>
);

beforeEach(() => {
    state.path = 'first.md';
    state.files = {};
    state.global = {};
});

describe('the Show menu', () => {
    it('lists every registered tab', () => {
        render(<Harness tabs={[tab('git'), tab('claude')]} />);
        expect(screen.getByTestId('show-keys')).toHaveTextContent('show-git,show-claude');
    });

    // The document stays where it is pinned, so there is nothing to choose for it.
    it('leaves the pinned tab out', () => {
        render(<Harness tabs={[tab('git'), tab('document', { defaultBar: 'center', pinned: true })]} />);
        expect(screen.getByTestId('show-keys')).toHaveTextContent('show-git');
    });
});
