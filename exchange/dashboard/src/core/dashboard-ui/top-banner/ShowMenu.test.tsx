import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
    global: {} as Record<string, any>,
}));

vi.mock('src/core/view-state', async () => {
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
        useGlobalViewState: (key: string, fallback: any) => scoped(() => state.global, key, fallback),
    };
});

import { ToolBarTab, ToolBarTabRegistration, ToolBarsProvider } from '../toolbars/ToolBars-ctx';
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
    state.global = {};
});

describe('the Show menu', () => {
    it('lists every registered tab in alphabetical order', () => {
        render(<Harness tabs={[tab('git'), tab('claude')]} />);
        expect(screen.getByTestId('show-keys').textContent).toBe('show-claude,show-git');
    });

    it('sorts by title, not by id', () => {
        render(<Harness tabs={[
            tab('zebra', { title: 'Apple' }),
            tab('apple', { title: 'Zebra' }),
        ]} />);
        expect(screen.getByTestId('show-keys').textContent)
            .toBe('show-zebra,show-apple');
    });

    // The document stays where it is pinned, so there is nothing to choose for it.
    it('leaves the pinned tab out', () => {
        render(<Harness tabs={[tab('git'), tab('document', { defaultBar: 'center', pinned: true })]} />);
        expect(screen.getByTestId('show-keys').textContent)
            .toBe('show-git');
    });
});
