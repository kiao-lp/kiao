import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Manifest providers share the application lifetime.
const probe = vi.hoisted(() => ({ mounts: 0 }));

const plugins = [
    {
        id: 'first',
        providers: [({ children }: { children?: React.ReactNode }) => (
            <div data-testid="first-provider">{children}</div>
        )],
    },
    {
        id: 'second',
        providers: [({ children }: { children?: React.ReactNode }) => {
            // Track the provider lifetime across document changes.
            React.useEffect(() => { probe.mounts += 1; }, []);
            return <div data-testid="second-provider">{children}</div>;
        }],
    },
];

vi.mock('../../extensibility/assembly', () => ({
    usePluginAssembly: () => ({ plugins, missing: [] }),
    PluginAssemblyProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    pluginCatalogue: [],
}));

import { PluginProviders } from './DashboardApp';

const MarkdownView: React.FC = () => <span>markdown view</span>;
const PdfView: React.FC = () => <span>pdf view</span>;

describe('PluginProviders', () => {
    beforeEach(() => { probe.mounts = 0; });

    it('wraps the tree in the provider a plugin declares', () => {
        render(<PluginProviders><MarkdownView /></PluginProviders>);
        expect(screen.getByTestId('second-provider')).toHaveTextContent('markdown view');
    });

    it('nests the plugins in registry order, the first one outermost', () => {
        render(<PluginProviders><MarkdownView /></PluginProviders>);
        expect(screen.getByTestId('first-provider'))
            .toContainElement(screen.getByTestId('second-provider'));
    });

    it('keeps its providers mounted across a change of active plugin', () => {
        const { rerender } = render(<PluginProviders><MarkdownView /></PluginProviders>);
        const provider = screen.getByTestId('second-provider');

        rerender(<PluginProviders><PdfView /></PluginProviders>);

        expect(screen.getByTestId('second-provider')).toBe(provider);
        expect(provider).toHaveTextContent('pdf view');
        expect(probe.mounts).toBe(1);
    });
});
