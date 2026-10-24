import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ showTab: vi.fn(), bars: true as boolean }));

// Record which panel a reveal brings forward.
vi.mock('src/cms-core/tool-bars/ToolBars-ctx', () => ({
    useToolBarsOptional: () => (h.bars ? { showTab: h.showTab } : null),
}));

import { RevealInTreeButton } from './RevealInTreeButton';
import { RevealInTreeProvider, useRevealInTree } from './RevealInTree-ctx';
import { FILE_NAVIGATION_TREE_TAB_ID } from './fileNavigationTab';

/** Stands in for the pane: what a tree would read off the context, written out. */
const Asked: React.FC = () => <span data-testid="asked">{useRevealInTree().request ?? '—'}</span>;

const show = (path: string | null) => render(
    <RevealInTreeProvider>
        <RevealInTreeButton path={path} data-testid="locate" />
        <Asked />
    </RevealInTreeProvider>,
);

const asked = () => screen.getByTestId('asked').textContent;

describe('RevealInTreeButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.bars = true;
    });

    it('asks the tree for the document it names', () => {
        show('units/abc/cadre.md');

        fireEvent.click(screen.getByTestId('locate'));

        expect(asked()).toBe('units/abc/cadre.md');
    });

    it('brings the file tree forward before asking', () => {
        show('units/abc/cadre.md');

        fireEvent.click(screen.getByTestId('locate'));

        expect(h.showTab).toHaveBeenCalledWith(FILE_NAVIGATION_TREE_TAB_ID);
    });

    // The store root is a row of the tree like any other, and its path is the empty string —
    // which is why nothing to point at is said with null rather than with an empty path.
    it('asks for the store root, which no path names', () => {
        show('');

        fireEvent.click(screen.getByTestId('locate'));

        expect(asked()).toBe('');
    });

    it('is dark, and asks nothing, with no path to point at', () => {
        show(null);

        expect(screen.getByTestId('locate')).toBeDisabled();
        fireEvent.click(screen.getByTestId('locate'));

        expect(asked()).toBe('—');
        expect(h.showTab).not.toHaveBeenCalled();
    });

    // It sits inside things that take a click as their own — a card that opens, a link that
    // navigates. Neither is what the crosshair was clicked for.
    it('leaves the click to nothing around it', () => {
        const around = vi.fn();
        render(
            <RevealInTreeProvider>
                <div onClick={around}>
                    <RevealInTreeButton path="units/abc/cadre.md" data-testid="locate" />
                </div>
            </RevealInTreeProvider>,
        );

        fireEvent.click(screen.getByTestId('locate'));

        expect(around).not.toHaveBeenCalled();
    });

    // Rendered outside the layout — a panel on its own in a test, a preview — it is a button
    // that does nothing rather than a component that throws.
    it('stands down where there is no layout to show a tab of', () => {
        h.bars = false;
        show('units/abc/cadre.md');

        fireEvent.click(screen.getByTestId('locate'));

        expect(asked()).toBe('units/abc/cadre.md');
    });
});
