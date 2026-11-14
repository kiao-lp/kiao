import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
    global: {} as Record<string, any>,
}));

const browsing = vi.hoisted(() => ({
    currentFile: { path: 'a.md', isDirectory: false } as { path: string; isDirectory: boolean } | null,
    currentPath: '',
}));

const nav = vi.hoisted(() => ({ open: vi.fn() }));
const areaRef = vi.hoisted(() => ({ fn: vi.fn() }));

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
import { CentralPanelControls, CentralStackProvider, useCentralStack } from './CentralStack-ctx';
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

const navigate = (path: string, isDirectory = false) => {
    browsing.currentFile = { path, isDirectory };
    browsing.currentPath = isDirectory ? path : path.split('/').slice(0, -1).join('/');
};

beforeEach(() => {
    state.global = {};
    browsing.currentFile = { path: 'a.md', isDirectory: false };
    browsing.currentPath = '';
    nav.open.mockClear();
    areaRef.fn.mockClear();
});

describe('the document panel', () => {
    it('publishes only the top panel controls and restores each level with its state', () => {
        const ValueContext = React.createContext('');
        const CounterControls: React.FC<{ onClick: () => void }> = ({ onClick }) =>
            <button onClick={onClick}>{React.useContext(ValueContext)}</button>;
        const Second: React.FC = () => {
            const [count, setCount] = React.useState(0);
            return <ValueContext.Provider value={`Second control ${count}`}>
                <CentralPanelControls>
                    <CounterControls onClick={() => setCount(value => value + 1)} />
                </CentralPanelControls>
                <input aria-label="Panel draft" />
            </ValueContext.Provider>;
        };
        const OpenPanels = () => {
            const { push } = useCentralStack();
            return <>
                <button onClick={() => push({ id: 'first', content: 'First', additionalPanels: <button>First control</button> })}>Open first</button>
                <button onClick={() => push({ id: 'second', content: <Second /> })}>Open second</button>
                <button onClick={() => push({ id: 'third', content: 'Third' })}>Open third</button>
                <button onClick={() => push({ id: 'elsewhere', host: 'another-tab', content: 'Elsewhere', additionalPanels: <button>Other control</button> })}>Open elsewhere</button>
            </>;
        };
        render(<ToolBarsProvider>
            <LayoutContent additionalPanels={<button>Document control</button>}><OpenPanels /></LayoutContent>
        </ToolBarsProvider>);
        const strip = screen.getByTestId('tool-bar-center').querySelector(':scope > .ant-tabs > .ant-tabs-nav')!;

        fireEvent.click(screen.getByText('Open first'));
        expect(strip).toContainElement(screen.getByText('First control'));
        expect(screen.queryByText('Document control')).toBeNull();
        fireEvent.click(screen.getByText('Open second'));
        expect(strip).toContainElement(screen.getByText('Second control 0'));
        expect(screen.queryByText('First control')).toBeNull();
        fireEvent.click(screen.getByText('Second control 0'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Panel draft' }), { target: { value: 'Keep me' } });
        expect(strip).toContainElement(screen.getByText('Second control 1'));

        fireEvent.click(screen.getByText('Open second'));
        expect(strip).toContainElement(screen.getByText('Second control 1'));

        fireEvent.click(screen.getByText('Open third'));
        expect(screen.queryByText('Second control 1')).toBeNull();
        expect(screen.queryByText('First control')).toBeNull();
        expect(screen.queryByText('Document control')).toBeNull();
        fireEvent.click(screen.getByText('Open elsewhere'));
        expect(screen.queryByText('Other control')).toBeNull();

        fireEvent.click(screen.getByTestId('central-panel-third-close'));
        expect(strip).toContainElement(screen.getByText('Second control 1'));
        expect(screen.getByRole('textbox', { name: 'Panel draft' })).toHaveValue('Keep me');
        fireEvent.click(screen.getByTestId('central-panel-second-close'));
        expect(strip).toContainElement(screen.getByText('First control'));
        fireEvent.click(screen.getByTestId('central-panel-first-close'));
        expect(strip).toContainElement(screen.getByText('Document control'));
        expect(screen.queryByText('Other control')).toBeNull();
    });

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

    it('preserves toolbar state when the document metadata changes', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(screen.getByTestId('layout-cell-git-center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);

        const saved = structuredClone(state.global);
        for (const [path, isDirectory] of [['b.md', false], ['docs', true], ['a.md', false]] as const) {
            navigate(path, isDirectory);
            rerender(<Harness />);

            expect(screen.getByTestId('active-center')).toHaveTextContent('git');
            expect(state.global).toEqual(saved);
        }
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
