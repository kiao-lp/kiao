import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileOptimizations } from 'kiao-worker';

const h = vi.hoisted(() => ({
    scan: vi.fn(async (): Promise<FileOptimizations> => ({
        duplicates: [],
        largest: [],
        scanned: 0,
        truncated: false,
    })),
    refreshFileList: vi.fn(),
}));

vi.mock('../files/service/ui', () => ({
    useWorkerClient: () => ({ getFileOptimizations: h.scan }),
}));

vi.mock('../files/core/CurrentFileList-ctx', () => ({
    useRefreshFileList: () => h.refreshFileList,
}));

import { CentralStackProvider, CentralStackView } from '../core/CentralStack-ctx';
import { FileOptimizationsProvider, useFileOptimizationsView } from './FileOptimizations-ctx';
import { FileOptimizationsStackPanel, FILE_OPTIMIZATIONS_PANEL_ID } from './FileOptimizationsView';

/**
 * The file-optimizations view as a panel on the central area's stack: the tools menu switches it
 * on, and it lands over whatever the area is showing — a document, a board — closing back onto
 * that. The flag outlives the panel, so a navigation with the view up brings it back.
 */

/** Switches the view the way the tools menu does. */
const Switch: React.FC = () => {
    const { show, hide } = useFileOptimizationsView();
    return (
        <>
            <button data-testid="show" onClick={() => show()}>Show</button>
            <button data-testid="hide" onClick={() => hide()}>Hide</button>
        </>
    );
};

/** One area under the app-level flag, remountable to stand in for a navigation. */
const Area: React.FC = () => (
    <CentralStackProvider>
        <div data-testid="document">the document</div>
        <FileOptimizationsStackPanel />
        <CentralStackView />
    </CentralStackProvider>
);

const Harness: React.FC<{ area: boolean }> = ({ area }) => (
    <FileOptimizationsProvider>
        <Switch />
        {area && <Area />}
    </FileOptimizationsProvider>
);

const panelId = `central-panel-${FILE_OPTIMIZATIONS_PANEL_ID}`;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FileOptimizationsStackPanel', () => {
    it('opens the view over the area when the menu switches it on', async () => {
        render(<Harness area />);

        fireEvent.click(screen.getByTestId('show'));

        const panel = await screen.findByTestId(panelId);
        expect(panel).toHaveAttribute('role', 'dialog');
        expect(panel).toHaveAccessibleName('File optimizations');
        expect(screen.getByTestId('file-optimizations-view')).toBeInTheDocument();
        expect(screen.getByTestId('document')).toBeInTheDocument();
        await waitFor(() => expect(h.scan).toHaveBeenCalledTimes(1));
    });

    it('closes through the floating cross, and opens again after', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('show'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId(`${panelId}-close`));
        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());

        // The cross switched the flag off rather than just hiding the panel: showing answers.
        fireEvent.click(screen.getByTestId('show'));
        await screen.findByTestId(panelId);
    });

    it('closes when the flag is switched off in code', async () => {
        render(<Harness area />);
        fireEvent.click(screen.getByTestId('show'));
        await screen.findByTestId(panelId);

        fireEvent.click(screen.getByTestId('hide'));

        await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    });

    it('comes back after the area is remounted', async () => {
        const { rerender } = render(<Harness area />);
        fireEvent.click(screen.getByTestId('show'));
        await screen.findByTestId(panelId);

        // A navigation: the area — and the panel with it — goes away and comes back, while the
        // app-level flag stays.
        rerender(<Harness area={false} />);
        expect(screen.queryByTestId(panelId)).toBeNull();
        rerender(<Harness area />);

        await screen.findByTestId(panelId);
        expect(screen.getByTestId('file-optimizations-view')).toBeInTheDocument();
    });
});
