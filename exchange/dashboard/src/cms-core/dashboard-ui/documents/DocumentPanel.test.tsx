import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** One scope bag per document, one app-wide. */
const state = vi.hoisted(() => ({
    path: 'a.md',
    files: {} as Record<string, Record<string, any>>,
    global: {} as Record<string, any>,
}));

/** Moves with `state.path` on navigation. */
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
    };
});

vi.mock('../../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => browsing,
}));

vi.mock('../../files/navigation/NavigationModel', () => ({
    useNavigation: () => nav,
}));

// Follower wiring only; followers are tested separately.
vi.mock('../../git/GitDiffStackPanel', async () => {
    const React = await import('react');
    return { GitDiffStackPanel: () => <div data-testid="follower-git-diff" /> };
});
vi.mock('../../files/browser/FileSearchResultsView', async () => {
    const React = await import('react');
    return { FileSearchResultsStackPanel: () => <div data-testid="follower-search" /> };
});

import { ToolBarTabRegistration, ToolBarsProvider, useToolBars } from '../toolbars/ToolBars-ctx';
import { ToolBarsSide } from '../toolbars/ToolBar-cmp';
import { LayoutGridCmp } from '../toolbars/LayoutGrid-cmp';
import { CentralStackProvider, useCentralStack } from './CentralStack-ctx';
import { documentTab } from './DocumentPanel';
import { DocumentContentProvider } from './DocumentContent-ctx';
import { LayoutContent } from '../layout/LayoutContent';

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
    return <>
        <button
            data-testid="push-panel"
            onClick={() => push({ id: 'probe', title: 'Probe', content: <div data-testid="probe-content" /> })}
        />
        <button
            data-testid="push-board-panel"
            onClick={() => push({ id: 'board-probe', host: 'hybridflow-ui-board', title: 'Board probe', content: <div data-testid="board-probe-content" /> })}
        />
    </>;
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

/** Moves browsing and view-state scope together. */
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
    it.each([false, true])('releases provider-dependent controls when leaving a document (next controls: %s)', nextControls => {
        const EditorContext = React.createContext(false);
        const EditorControls = () => {
            if (!React.useContext(EditorContext)) throw new Error('Editor controls need their provider');
            return <button>Editor control</button>;
        };
        const Editor = () => <LayoutContent additionalPanels={<EditorControls />}>Editor document</LayoutContent>;
        const OtherDocument = () => <LayoutContent additionalPanels={nextControls && <button>Other control</button>}>
            Other document
        </LayoutContent>;
        const app = (editing: boolean) => <ToolBarsProvider>
            {editing
                ? <EditorContext.Provider value={true}><Editor /></EditorContext.Provider>
                : <OtherDocument />}
        </ToolBarsProvider>;
        const { rerender } = render(app(true));
        expect(screen.getByText('Editor control')).toBeVisible();

        rerender(app(false));

        expect(screen.getByText('Other document')).toBeVisible();
        expect(screen.queryByText('Editor control')).toBeNull();
        expect(screen.getByTestId('tool-bar-center').classList.contains('cms-tool-bar-single')).toBe(!nextControls);
        if (nextControls) expect(screen.getByText('Other control')).toBeVisible();

        rerender(app(true));

        expect(screen.getByText('Editor control')).toBeVisible();
        expect(screen.queryByText('Other control')).toBeNull();
    });

    it('keeps the layout controls current in the document strip', () => {
        const layout = (label?: string) => <ToolBarsProvider>
            <LayoutContent additionalPanels={label && <button>{label}</button>}>
                <input aria-label="Document draft" defaultValue="" />
            </LayoutContent>
        </ToolBarsProvider>;
        const { rerender } = render(layout('First control'));
        const bar = screen.getByTestId('tool-bar-center');
        const strip = bar.querySelector(':scope > .ant-tabs > .ant-tabs-nav');
        expect(strip).toContainElement(screen.getByText('First control'));
        expect(bar).not.toHaveClass('cms-tool-bar-single');
        fireEvent.change(screen.getByRole('textbox', { name: 'Document draft' }), { target: { value: 'draft' } });

        rerender(layout('Updated control'));

        expect(strip).toContainElement(screen.getByText('Updated control'));
        expect(screen.queryByText('First control')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Document draft' })).toHaveValue('draft');

        rerender(layout());

        expect(bar).toHaveClass('cms-tool-bar-single');
        expect(screen.queryByText('Updated control')).toBeNull();
    });

    it('draws the layout content with the stack and the mode followers over it', () => {
        render(<Harness />);

        const area = document.querySelector('.cms-document-area');
        expect(area).not.toBeNull();
        expect(area).toContainElement(screen.getByTestId('doc-content'));
        expect(area).toContainElement(screen.getByTestId('follower-git-diff'));
        expect(area).toContainElement(screen.getByTestId('follower-search'));
        expect(screen.queryByTestId('central-stack')).toBeNull();
        // areaRef receives the panel element for dialogs.
        expect(areaRef.fn).toHaveBeenCalledWith(area);

        fireEvent.click(screen.getByTestId('push-panel'));

        expect(screen.getByTestId('tool-bar-center')).toContainElement(screen.getByTestId('central-panel-probe'));
    });

    it('reads the layout content live rather than capturing it in the registration', () => {
        const { rerender } = render(<Harness content={<div data-testid="doc-v1" />} />);
        expect(screen.getByTestId('doc-v1')).toBeInTheDocument();

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

        expect(screen.getByTestId('doc-content')).toBeInTheDocument();
        expect(screen.getByTestId('follower-git-diff')).toBeInTheDocument();
    });

    it('comes back in front when the browsing lands elsewhere', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);

        navigate('b.md');
        rerender(<Harness />);

        // No centre choice: opens on document, no state write.
        expect(screen.getByTestId('active-center')).toHaveTextContent('document');
        expect(state.files['b.md']?.toolBars).toBeUndefined();

        // Prior centre choice: returns to document on navigation.
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        navigate('a.md');
        rerender(<Harness />);

        expect(screen.getByTestId('active-center')).toHaveTextContent('document');
        expect(state.files['a.md'].toolBars.selected.center).toBe('document');
    });

    it('stays behind another central tab for a panel hosted there', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        expect(screen.getByTestId('active-center')).toHaveTextContent('git');

        fireEvent.click(screen.getByTestId('push-board-panel'));

        expect(screen.getByTestId('active-center')).toHaveTextContent('git');
        expect(screen.queryByTestId('central-panel-board-probe')).toBeNull();
    });

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
