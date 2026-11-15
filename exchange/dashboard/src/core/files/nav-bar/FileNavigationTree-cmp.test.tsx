import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// FileTreeCmp is mocked; this suite covers the surrounding pane.
vi.mock('./FileTree-cmp', () => ({
    FileTreeCmp: ({ revealRequest }: { revealRequest?: number }) => (
        <div data-testid="reveal-request">{revealRequest}</div>
    ),
}));
vi.mock('../context-menu/RowContextMenu', async () => ({
    RowContextMenu: (await import('src/test/mocks')).Children,
}));

const refreshFileList = vi.fn();
vi.mock('../core/CurrentFileList-ctx', () => ({
    useRefreshFileList: () => refreshFileList,
}));

import { FileNavigationTreeCmp } from './FileNavigationTree-cmp';

describe('FileNavigationTreeCmp', () => {
    it('asks the tree to show the open document on every click of the locate button', () => {
        render(<FileNavigationTreeCmp />);
        const requests = () => screen.getByTestId('reveal-request').textContent;
        const asked = requests();

        fireEvent.click(screen.getByTestId('nav-locate-current'));
        expect(requests()).not.toEqual(asked);

        // Asked twice for the same document: the second click must count as its own request.
        const askedAgain = requests();
        fireEvent.click(screen.getByTestId('nav-locate-current'));
        expect(requests()).not.toEqual(askedAgain);
    });

    it('stands the refresh to the left of the locate button, and refreshes on click', () => {
        render(<FileNavigationTreeCmp />);
        const actions = screen.getByTestId('nav-locate-current').parentElement!.parentElement!;
        const buttons = Array.from(actions.querySelectorAll('button')).map(button => button.dataset.testid);
        expect(buttons).toEqual(['nav-refresh-tree', 'nav-locate-current']);

        refreshFileList.mockClear();
        fireEvent.click(screen.getByTestId('nav-refresh-tree'));
        expect(refreshFileList).toHaveBeenCalledTimes(1);
    });
});
