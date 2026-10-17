import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** The same stand-in as the tool bars' own tests: one scope bag per document, one app-wide. */
const state = vi.hoisted(() => ({
    path: 'a.md',
    files: {} as Record<string, Record<string, any>>,
    global: {} as Record<string, any>,
}));

/** Where the browsing stands. Moved together with `state.path`, as navigating does. */
const browsing = vi.hoisted(() => ({
    currentFile: { path: 'a.md', isDirectory: false } as { path: string; isDirectory: boolean } | null,
    currentPath: '',
}));

const nav = vi.hoisted(() => ({ open: vi.fn() }));
const areaRef = vi.hoisted(() => ({ fn: vi.fn() }));

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
        useScrollMemory: () => { },
    };
});

vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => browsing,
}));

vi.mock('../files/navigation/NavigationModel', () => ({
    useNavigation: () => nav,
}));

// The mode followers have tests of their own; what this file pins is that the document panel still
// carries them, now that it is a tab rather than the area itself.
vi.mock('../toolbar/GitDiffView', async () => {
    const React = await import('react');
    return { GitDiffStackPanel: () => <div data-testid="follower-git-diff" /> };
});
vi.mock('../file-optimizations/FileOptimizationsView', async () => {
    const React = await import('react');
    return { FileOptimizationsStackPanel: () => <div data-testid="follower-optimizations" /> };
});
vi.mock('../files/browser/FileSearchResultsView', async () => {
    const React = await import('react');
    return { FileSearchResultsStackPanel: () => <div data-testid="follower-search" /> };
});

import { ToolBarTabRegistration, ToolBarsProvider, useToolBars } from '../tool-bars/ToolBars-ctx';
import { ToolBarsSide } from '../tool-bars/ToolBar-cmp';
import { LayoutGridCmp } from '../tool-bars/LayoutGrid-cmp';
import { CentralStackProvider, useCentralStack } from './CentralStack-ctx';
import { DocumentContentProvider, documentTab } from './DocumentPanel';

const GIT = {
    id: 'git',
    title: 'git',
    render: () => <div data-testid="panel-git" />,
};

const ActiveProbe: React.FC = () => {
    const bars = useToolBars();
    return <div data-testid="active-center">{bars.activeIn('center')}</div>;
};

const PushProbe: React.FC = () => {
    const { push } = useCentralStack();
    return <button
        data-testid="push-panel"
        onClick={() => push({ id: 'probe', title: 'Probe', content: <div data-testid="probe-content" /> })}
    />;
};

const Harness: React.FC<{ content?: React.ReactNode }> = ({ content }) => (
    <ToolBarsProvider>
        <CentralStackProvider>
            <DocumentContentProvider value={{ content: content ?? <div data-testid="doc-content" />, areaRef: areaRef.fn }}>
                <ToolBarTabRegistration tab={documentTab} />
                <ToolBarTabRegistration tab={GIT} />
                <ToolBarsSide side="center" />
                <LayoutGridCmp tabId="git" />
                <ActiveProbe />
                <PushProbe />
            </DocumentContentProvider>
        </CentralStackProvider>
    </ToolBarsProvider>
);

/** Navigating: the browsing and the view-state scope move together, as in the app. */
const navigate = (path: string, isDirectory = false) => {
    state.path = path;
    browsing.currentFile = { path, isDirectory };
    browsing.currentPath = isDirectory ? path : path.split('/').slice(0, -1).join('/');
};

beforeEach(() => {
    state.path = 'a.md';
    state.files = {};
    state.global = {};
    browsing.currentFile = { path: 'a.md', isDirectory: false };
    browsing.currentPath = '';
    nav.open.mockClear();
    areaRef.fn.mockClear();
});

describe('the document panel', () => {
    it('draws the layout content with the stack and the mode followers over it', () => {
        render(<Harness />);

        const area = document.querySelector('.cms-document-area');
        expect(area).not.toBeNull();
        expect(area).toContainElement(screen.getByTestId('doc-content'));
        expect(area).toContainElement(screen.getByTestId('follower-git-diff'));
        expect(area).toContainElement(screen.getByTestId('follower-optimizations'));
        expect(area).toContainElement(screen.getByTestId('follower-search'));
        // The stack starts empty: pushed panels cover the document, nothing else does.
        expect(screen.queryByTestId('central-stack')).toBeNull();
        // The layout publishes the panel's element as the area dialogs render into.
        expect(areaRef.fn).toHaveBeenCalledWith(area);

        fireEvent.click(screen.getByTestId('push-panel'));

        expect(area).toContainElement(screen.getByTestId('central-panel-probe'));
    });

    it('reads the layout content live rather than capturing it in the registration', () => {
        const { rerender } = render(<Harness content={<div data-testid="doc-v1" />} />);
        expect(screen.getByTestId('doc-v1')).toBeInTheDocument();

        // A fresh element, as navigating renders one: the registration is not made again — same
        // tab id — and still the new content shows.
        rerender(<Harness content={<div data-testid="doc-v2" />} />);

        expect(screen.queryByTestId('doc-v1')).toBeNull();
        expect(screen.getByTestId('doc-v2')).toBeInTheDocument();
    });

    it('closes a file back to its folder, and draws no cross for a folder', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(screen.getByTestId('close-document'));
        expect(nav.open).toHaveBeenCalledWith('');

        navigate('docs', true);
        rerender(<Harness />);
        expect(screen.queryByTestId('close-document')).toBeNull();
    });

    it('is mounted even while another tab of the centre is showing', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        expect(screen.getByTestId('active-center')).toHaveTextContent('git');

        // The editor, the scroll memory and the followers stay mounted behind the tab in front.
        expect(screen.getByTestId('doc-content')).toBeInTheDocument();
        expect(screen.getByTestId('follower-git-diff')).toBeInTheDocument();
    });

    // Clicking a file opens it in the document panel: landing somewhere else while another tab of
    // the centre is showing brings the document back in front.
    it('comes back in front when the browsing lands elsewhere', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);

        navigate('b.md');
        rerender(<Harness />);

        // A document that never chose in the centre opens on the document without a write.
        expect(screen.getByTestId('active-center')).toHaveTextContent('document');
        expect(state.files['b.md']?.toolBars).toBeUndefined();

        // …while one that chose the other tab is brought back onto the document it just opened.
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        navigate('a.md');
        rerender(<Harness />);

        expect(screen.getByTestId('active-center')).toHaveTextContent('document');
        expect(state.files['a.md'].toolBars.selected.center).toBe('document');
    });

    // A pushed panel covers the document and nothing else, so one pushed while another tab of the
    // centre is showing brings the document back in front with it.
    it('comes back in front with a panel pushed over it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        expect(screen.getByTestId('active-center')).toHaveTextContent('git');

        fireEvent.click(screen.getByTestId('push-panel'));

        expect(screen.getByTestId('active-center')).toHaveTextContent('document');
        expect(screen.getByTestId('central-panel-probe')).toBeInTheDocument();
    });
});
