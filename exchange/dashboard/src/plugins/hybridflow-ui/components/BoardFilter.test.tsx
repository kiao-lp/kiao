import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BoardFilter, BOARD_ZOOM_LEVELS } from './BoardFilter';

/**
 * The bar above the board: the tags it can be asked about, and the size it is read at. The tags
 * come and go with the board — a board of untagged cards has nothing to be asked about it — but
 * the zoom is always there: such a board still has a size to be read at.
 */

vi.mock('@cms-kit/capabilities', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-kit/capabilities')>()),
    useTagsAvailable: () => true,
    useTagsUi: () => ({
        TagChips: ({ labels }: { labels?: string[] }) => (
            <>{(labels ?? []).map(label => <span key={label} data-testid="tag-chip">{label}</span>)}</>
        ),
        TagPicker: () => null,
    }),
}));

const show = (over: Record<string, unknown> = {}) => render(
    <BoardFilter
        tags={['bug', 'ui']}
        selected={[]}
        onToggle={() => {}}
        onClear={() => {}}
        shown={3}
        total={3}
        zoom={1}
        onZoomChange={() => {}}
        {...over}
    />,
);

/** The zoom box, inside the bar. */
const select = (): HTMLElement | null =>
    screen.getByTestId('board-filter').querySelector('.ant-select');

/** rc-select renders its dropdown in a portal, so an option is found from the document. */
const option = (label: string): HTMLElement =>
    [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
        .find(item => item.textContent === label) as HTMLElement;

const openZoom = () => {
    fireEvent.mouseDown(select()!.querySelector('.ant-select-selector, .ant-select-content')!);
};

beforeEach(() => {
    // antd's popups measure themselves, and jsdom has no ResizeObserver.
    vi.stubGlobal('ResizeObserver', class {
        observe() { /* nothing to measure */ }
        unobserve() { /* nothing to measure */ }
        disconnect() { /* nothing to measure */ }
    });
});
afterEach(cleanup);

describe('the bar above the board', () => {
    it('shows the size the board is being read at', () => {
        show({ zoom: 1.25 });

        expect(select()).not.toBeNull();
        expect(screen.getByText('125%')).toBeInTheDocument();
    });

    it('offers the board from a quarter of its size to a quarter past it', () => {
        show();
        openZoom();

        expect(BOARD_ZOOM_LEVELS).toEqual([0.25, 0.5, 0.7, 0.8, 0.9, 1, 1.25]);
        expect([...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
            .map(item => item.textContent)).toEqual(['25%', '50%', '70%', '80%', '90%', '100%', '125%']);
    });

    it('reports the size that was picked', () => {
        const onZoomChange = vi.fn();
        show({ onZoomChange });
        openZoom();

        fireEvent.click(option('50%'));

        // The first argument alone: the select hands its own option object along as a second.
        expect(onZoomChange.mock.calls[0][0]).toBe(0.5);
    });

    it('keeps the zoom where the board wears no tag', () => {
        show({ tags: [] });

        expect(screen.queryAllByTestId('board-filter-tag')).toHaveLength(0);
        expect(select()).not.toBeNull();
    });
});
