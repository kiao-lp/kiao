import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
    original: 'line one\n',
    working: 'line one\nline two\n',
    gitOriginal: vi.fn(async (_path: string, _folder: string) => h.original),
    gitWorking: vi.fn(async (_path: string, _folder: string) => h.working),
    gitSave: vi.fn(async (_path: string, _text: string, _folder: string) => ({ ok: true, output: '' })),
}));

vi.mock('../files/service/ui', () => ({
    useWorkerClient: () => ({
        gitOriginal: h.gitOriginal,
        gitWorking: h.gitWorking,
        gitSave: h.gitSave,
    }),
}));

vi.mock('@uiw/react-codemirror', () => ({
    // CodeMirror stands in as a textarea: the assertions are on the text that travels, not the widget.
    default: ({ value, onChange, readOnly }: {
        value?: string;
        onChange?: (v: string) => void;
        readOnly?: boolean;
    }) => (
        <textarea
            aria-label={readOnly ? 'Head pane' : 'Working tree pane'}
            value={value ?? ''}
            readOnly={readOnly}
            onChange={event => onChange?.(event.target.value)}
        />
    ),
}));

const nav = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('../files/navigation/NavigationModel', () => ({
    useNavigation: () => ({ open: nav.open }),
}));

import { GitDiffProvider, useGitDiff } from './GitDiff-ctx';
import { CentralStackProvider, CentralStackView } from '../core/CentralStack-ctx';
import { GitDiffStackPanel, GIT_DIFF_PANEL_ID } from './GitDiffView';

/**
 * The diff as a panel on the central area's stack. What it owes the git panel is two things: the
 * diff lands over whatever the area is showing, and what was typed in the working-tree pane
 * survives the area going away — a document or a board navigated to with the diff open.
 */

/** Opens and closes the diff the way the git panel does. */
const Opener: React.FC = () => {
    const { openDiff, closeDiff } = useGitDiff();
    return (
        <>
            <button data-testid="open-a" onClick={() => openDiff('notes.md', '')}>Open A</button>
            <button data-testid="open-b" onClick={() => openDiff('other.md', 'sub')}>Open B</button>
            <button data-testid="open-c" onClick={() => openDiff('file.md', 'sub', 'nested/repo')}>Open C</button>
            <button data-testid="close" onClick={() => closeDiff()}>Close</button>
        </>
    );
};

/** One area under the app-level target, remountable to stand in for a navigation. */
const Area: React.FC = () => (
    <CentralStackProvider>
        <div data-testid="document">the document</div>
        <GitDiffStackPanel />
        <CentralStackView />
    </CentralStackProvider>
);

const Harness: React.FC<{ area: boolean }> = ({ area }) => (
    <GitDiffProvider>
        <Opener />
        {area && <Area />}
    </GitDiffProvider>
);

const panelId = `central-panel-${GIT_DIFF_PANEL_ID}`;

beforeEach(() => {
    vi.clearAllMocks();
    h.original = 'line one\n';
    h.working = 'line one\nline two\n';
    nav.open.mockClear();
});

describe('GitDiffStackPanel', () => {
    it('opens the diff over the area when the git panel names a file', async () => {
        render(<Harness area />);

        fireEvent.click(screen.getByTestId('open-a'));

        const panel = await screen.findByTestId(panelId);
        expect(panel).toHaveAttribute('role', 'dialog');
        expect(panel).toHaveAccessibleName('Diff of notes.md');
        expect(screen.getByTestId('document')).toBeInTheDocument();
        expect(await screen.findByLabelText('Working tree pane')).toHaveValue(h.working);
    });

    it('retargets the one panel when another file is opened', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId('open-b'));

        await waitFor(() => expect(h.gitWorking).toHaveBeenCalledWith('other.md', 'sub'));
        expect(screen.getAllByTestId(panelId)).toHaveLength(1);
        expect(screen.getByTestId(panelId)).toHaveAccessibleName('Diff of other.md');
    });

    it('closes through the floating cross, and opens again after', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId(`${panelId}-close`));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());

        // The cross cleared the target rather than just hiding the panel: opening again answers.
        fireEvent.click(screen.getByTestId('open-a'));
        await screen.findByTestId(panelId);
    });

    it('closes when the target is cleared in code', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId('close'));

        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });

    it('restores unsaved edits after the area is remounted', async () => {
        const { rerender } = render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        const pane = await screen.findByLabelText('Working tree pane');

        fireEvent.change(pane, { target: { value: 'line one\nline two\nline three\n' } });
        expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();

        // A navigation: the area — and the panel with it — goes away and comes back, while the
        // app-level target stays.
        rerender(<Harness area={false} />);
        expect(screen.queryByTestId(panelId)).toBeNull();
        rerender(<Harness area />);

        expect(await screen.findByLabelText('Working tree pane'))
            .toHaveValue('line one\nline two\nline three\n');
        expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
    });

    it('drops the draft when the tree moved under it', async () => {
        const { rerender } = render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        const pane = await screen.findByLabelText('Working tree pane');
        fireEvent.change(pane, { target: { value: 'line one\nline two\nline three\n' } });

        // The file was reverted elsewhere while the diff was away: what was typed was against
        // other lines.
        h.working = 'entirely rewritten\n';
        rerender(<Harness area={false} />);
        rerender(<Harness area />);

        expect(await screen.findByLabelText('Working tree pane')).toHaveValue('entirely rewritten\n');
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('saves the pane back through the client', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        const pane = await screen.findByLabelText('Working tree pane');
        fireEvent.change(pane, { target: { value: 'line one\nline two\nline three\n' } });

        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(h.gitSave)
            .toHaveBeenCalledWith('notes.md', 'line one\nline two\nline three\n', ''));
        await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeDisabled());
    });

    it('opens the working-tree file in place and closes the diff', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-a'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByRole('button', { name: 'Open file' }));

        await waitFor(() => expect(nav.open).toHaveBeenCalledWith('notes.md'));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });

    it('opens a nested repository file by its store path', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('open-c'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByRole('button', { name: 'Open file' }));

        await waitFor(() => expect(nav.open).toHaveBeenCalledWith('nested/repo/file.md'));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });
});
